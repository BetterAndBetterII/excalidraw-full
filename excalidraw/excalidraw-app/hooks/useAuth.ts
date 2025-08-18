import { useEffect } from "react";
import { jwtDecode } from "jwt-decode";
import { User } from "../app-jotai";

export const useAuth = (setUser: (user: User | null) => void) => {
  useEffect(() => {
    // Check for token in URL params, which happens after GitHub login redirect.
    const searchParams = new URLSearchParams(window.location.search);
    const token = searchParams.get("token");
    if (token) {
      localStorage.setItem("token", token);
      // Clean the token from the URL.
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const storedToken = localStorage.getItem("token");
    if (storedToken) {
      try {
        const decodedToken: any = jwtDecode(storedToken);
        // Check if token is expired.
        if (decodedToken.exp * 1000 > Date.now()) {
          setUser({
            id: decodedToken.sub,
            subject: decodedToken.sub,
            login: decodedToken.login,
            email: decodedToken.email,
            avatarUrl: decodedToken.avatarUrl,
            name: decodedToken.name,
          });
        } else {
          // Token is expired, remove it.
          localStorage.removeItem("token");
          setUser(null);
        }
      } catch (error) {
        console.error("Invalid token:", error);
        localStorage.removeItem("token");
        setUser(null);
      }
    }
  }, [setUser]);
};
