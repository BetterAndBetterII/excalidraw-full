package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"excalidraw-complete/core"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/golang-jwt/jwt/v5"
	"github.com/sirupsen/logrus"
	"golang.org/x/oauth2"
)

var (
	oidcOauthConfig *oauth2.Config
	oidcProvider    *oidc.Provider
	verifier        *oidc.IDTokenVerifier
)

// OIDCClaims represents the claims from OIDC token
type OIDCClaims struct {
	Email             string `json:"email"`
	Name              string `json:"name"`
	PreferredUsername string `json:"preferred_username"`
	Picture           string `json:"picture"`
	Sub               string `json:"sub"`
}

func InitDex() {
	providerURL := os.Getenv("OIDC_ISSUER_URL")
	clientID := os.Getenv("OIDC_CLIENT_ID")
	clientSecret := os.Getenv("OIDC_CLIENT_SECRET")
	redirectURL := os.Getenv("OIDC_REDIRECT_URL")

	if providerURL == "" || clientID == "" || clientSecret == "" {
		logrus.Warn("OIDC credentials are not set. OIDC authentication routes will not work.")
		return
	}

	var err error
	oidcProvider, err = oidc.NewProvider(context.Background(), providerURL)
	if err != nil {
		logrus.Errorf("Failed to create OIDC provider: %s", err.Error())
		return
	}

	oidcOauthConfig = &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
		Endpoint:     oidcProvider.Endpoint(),
	}

	logrus.Info("OIDC provider initialized")

	verifier = oidcProvider.Verifier(&oidc.Config{
		ClientID: clientID,
	})
}

func HandleOIDCLogin(w http.ResponseWriter, r *http.Request) {
	if oidcOauthConfig == nil {
		http.Error(w, "OIDC is not configured", http.StatusInternalServerError)
		return
	}

	// Generate random state
	stateBytes := make([]byte, 16)
	_, err := rand.Read(stateBytes)
	if err != nil {
		http.Error(w, "Failed to generate state for OIDC login", http.StatusInternalServerError)
		return
	}
	state := hex.EncodeToString(stateBytes)

	// Set state in a cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "oidc_state",
		Value:    state,
		Path:     "/",
		Expires:  time.Now().Add(10 * time.Minute), // 10 minutes expiry
		HttpOnly: true,
		Secure:   r.Header.Get("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteLaxMode,
	})

	url := oidcOauthConfig.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func HandleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	if oidcOauthConfig == nil {
		http.Error(w, "OIDC is not configured", http.StatusInternalServerError)
		return
	}

	// Verify state cookie
	stateCookie, err := r.Cookie("oidc_state")
	if err != nil {
		http.Error(w, "State cookie not found", http.StatusBadRequest)
		return
	}

	if r.URL.Query().Get("state") != stateCookie.Value {
		http.Error(w, "Invalid state", http.StatusBadRequest)
		return
	}

	// Clear state cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "oidc_state",
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Secure:   r.Header.Get("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteLaxMode,
	})

	code := r.FormValue("code")
	if code == "" {
		logrus.Error("no code in callback")
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	token, err := oidcOauthConfig.Exchange(context.Background(), code)
	if err != nil {
		logrus.Errorf("failed to exchange token: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		logrus.Error("no id_token in token response")
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	idToken, err := verifier.Verify(context.Background(), rawIDToken)
	if err != nil {
		logrus.Errorf("failed to verify ID token: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	var claims OIDCClaims
	if err := idToken.Claims(&claims); err != nil {
		logrus.Errorf("failed to extract claims from ID token: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	// Create user from OIDC claims
	user := &core.User{
		Subject:   claims.Sub,
		Login:     claims.PreferredUsername,
		Email:     claims.Email,
		AvatarURL: claims.Picture,
		Name:      claims.Name,
	}

	// If preferred_username is not available, use email
	if user.Login == "" && user.Email != "" {
		user.Login = user.Email
	}

	jwtToken, err := createOIDCJWT(user)
	if err != nil {
		logrus.Errorf("failed to create JWT: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	// Redirect to frontend with token
	http.Redirect(w, r, fmt.Sprintf("/?token=%s", jwtToken), http.StatusTemporaryRedirect)
}

func createOIDCJWT(user *core.User) (string, error) {
	claims := AppClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.Subject,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour * 24 * 7)), // 1 week
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		Login:     user.Login,
		AvatarURL: user.AvatarURL,
		Name:      user.Name,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}
