package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"excalidraw-complete/core"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/sirupsen/logrus"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"

	"encoding/hex"

	"github.com/coreos/go-oidc/v3/oidc"
)

var (
	loginHandler    http.HandlerFunc
	callbackHandler http.HandlerFunc
)

var (
	githubOauthConfig *oauth2.Config
	jwtSecret         []byte

	oidcOauthConfig *oauth2.Config
	oidcProvider    *oidc.Provider
	verifier        *oidc.IDTokenVerifier
)

// AppClaims represents the custom claims for the JWT.
type AppClaims struct {
	jwt.RegisteredClaims
	Login     string `json:"login"`
	AvatarURL string `json:"avatarUrl"`
	Name      string `json:"name"`
}

// OIDCClaims represents the claims from OIDC token
type OIDCClaims struct {
	Email             string `json:"email"`
	Name              string `json:"name"`
	PreferredUsername string `json:"preferred_username"`
	Picture           string `json:"picture"`
	Sub               string `json:"sub"`
}

func InitAuth() {
	oidcConfigured := os.Getenv("OIDC_ISSUER_URL") != "" && os.Getenv("OIDC_CLIENT_ID") != ""
	githubConfigured := os.Getenv("GITHUB_CLIENT_ID") != "" && os.Getenv("GITHUB_CLIENT_SECRET") != ""

	if oidcConfigured {
		logrus.Info("Initializing OIDC authentication provider.")
		initOIDC()
		loginHandler = HandleOIDCLogin
		callbackHandler = HandleOIDCCallback
	} else if githubConfigured {
		logrus.Info("Initializing GitHub authentication provider.")
		initGitHub()
		loginHandler = HandleGitHubLogin
		callbackHandler = HandleGitHubCallback
	} else {
		logrus.Warn("No authentication provider configured.")
		dummyHandler := func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Authentication not configured", http.StatusInternalServerError)
		}
		loginHandler = dummyHandler
		callbackHandler = dummyHandler
	}

	jwtSecret = []byte(os.Getenv("JWT_SECRET"))
	if len(jwtSecret) == 0 {
		logrus.Warn("JWT_SECRET is not set. Authentication will not work.")
	}
}

func HandleLogin(w http.ResponseWriter, r *http.Request) {
	if loginHandler != nil {
		loginHandler(w, r)
	} else {
		http.Error(w, "Authentication not configured", http.StatusInternalServerError)
	}
}

func HandleCallback(w http.ResponseWriter, r *http.Request) {
	if callbackHandler != nil {
		callbackHandler(w, r)
	} else {
		http.Error(w, "Authentication not configured", http.StatusInternalServerError)
	}
}

func initGitHub() {
	githubOauthConfig = &oauth2.Config{
		ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("GITHUB_REDIRECT_URL"),
		Scopes:       []string{"read:user", "user:email"},
		Endpoint:     github.Endpoint,
	}

	if githubOauthConfig.ClientID == "" || githubOauthConfig.ClientSecret == "" {
		logrus.Warn("GitHub OAuth credentials are not set. Authentication routes will not work.")
	}
}

func initOIDC() {
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

// Init function is deprecated, use InitAuth instead
func Init() {
	initGitHub()

	jwtSecret = []byte(os.Getenv("JWT_SECRET"))

	if githubOauthConfig.ClientID == "" || githubOauthConfig.ClientSecret == "" {
		logrus.Warn("GitHub OAuth credentials are not set. Authentication routes will not work.")
	}
	if len(jwtSecret) == 0 {
		logrus.Warn("JWT_SECRET is not set. Authentication routes will not work.")
	}
}

func generateStateOauthCookie(w http.ResponseWriter) string {
	b := make([]byte, 16)
	rand.Read(b)
	state := base64.URLEncoding.EncodeToString(b)
	cookie := &http.Cookie{
		Name:     "oauthstate",
		Value:    state,
		Expires:  time.Now().Add(10 * time.Minute),
		HttpOnly: true,
	}
	http.SetCookie(w, cookie)
	return state
}

func HandleGitHubLogin(w http.ResponseWriter, r *http.Request) {
	if githubOauthConfig.ClientID == "" {
		http.Error(w, "GitHub OAuth is not configured", http.StatusInternalServerError)
		return
	}
	state := generateStateOauthCookie(w)
	url := githubOauthConfig.AuthCodeURL(state)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func HandleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	if githubOauthConfig.ClientID == "" {
		http.Error(w, "GitHub OAuth is not configured", http.StatusInternalServerError)
		return
	}

	token, err := githubOauthConfig.Exchange(context.Background(), r.FormValue("code"))
	if err != nil {
		logrus.Errorf("failed to exchange token: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	client := githubOauthConfig.Client(context.Background(), token)
	resp, err := client.Get("https://api.github.com/user")
	if err != nil {
		logrus.Errorf("failed to get user from github: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		logrus.Errorf("failed to read github response body: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	var githubUser struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		AvatarURL string `json:"avatar_url"`
		Name      string `json:"name"`
	}

	if err := json.Unmarshal(body, &githubUser); err != nil {
		logrus.Errorf("failed to unmarshal github user: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	// Create user object using Subject instead of GitHubID
	user := &core.User{
		Subject:   fmt.Sprintf("github:%d", githubUser.ID),
		Login:     githubUser.Login,
		AvatarURL: githubUser.AvatarURL,
		Name:      githubUser.Name,
	}

	jwtToken, err := createJWT(user)
	if err != nil {
		logrus.Errorf("failed to create JWT: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	// Redirect to frontend with token
	http.Redirect(w, r, fmt.Sprintf("/?token=%s", jwtToken), http.StatusTemporaryRedirect)
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

	jwtToken, err := createJWT(user)
	if err != nil {
		logrus.Errorf("failed to create JWT: %s", err.Error())
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	// Redirect to frontend with token
	http.Redirect(w, r, fmt.Sprintf("/?token=%s", jwtToken), http.StatusTemporaryRedirect)
}

func createJWT(user *core.User) (string, error) {
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

func ParseJWT(tokenString string) (*AppClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &AppClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*AppClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}
