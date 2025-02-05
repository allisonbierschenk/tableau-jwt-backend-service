package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/dgrijalva/jwt-go" 
	"github.com/joho/godotenv"     
	"github.com/google/uuid"        
	"github.com/rs/cors"         
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"time"
)

// Struct to hold Tableau authentication request data, what I am using for authenticating into the application. This is not required but a user store somewhere is required.
type TsRequest struct {
	Credentials struct {
		PersonalAccessTokenName    string `json:"personalAccessTokenName"`
		PersonalAccessTokenSecret  string `json:"personalAccessTokenSecret"`
		Site struct {
			ContentUrl string `json:"contentUrl"`
		} `json:"site"`
	} `json:"credentials"`
}

// Function to generate a JWT token
func generateJWT() (string, error) {
	// Define JWT claims (payload)
	claims := jwt.MapClaims{
		"iss": os.Getenv("CONNECTED_APP_CLIENT_ID"), // Issuer ID from environment variables
		"exp": time.Now().Add(5 * time.Minute).Unix(), // Token expiration time (5 min from now)
		"jti": uuid.New().String(), // Unique token ID
		"aud": "tableau", // Audience (who the token is for)
		"sub": "odatest", // Subject (user identifier)
		"scp": []string{"tableau:views:embed"}, // Permissions
		"https://tableau.com/oda": "true", // Custom Tableau claim
		"https://tableau.com/groups": []string{"odatest"}, // User groups
	}

	// Create a new JWT token using HS256 signing method
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	// Add key ID and issuer to token header
	token.Header["kid"] = os.Getenv("CONNECTED_APP_SECRET_ID")
	token.Header["iss"] = os.Getenv("CONNECTED_APP_CLIENT_ID")

	// Get the secret key from environment variables
	secretKey := os.Getenv("CONNECTED_APP_SECRET_KEY")
	if secretKey == "" {
		log.Println("❌ ERROR: CONNECTED_APP_SECRET_KEY is not set.")
		return "", fmt.Errorf("missing CONNECTED_APP_SECRET_KEY")
	}

	// Sign the token with the secret key
	signedToken, err := token.SignedString([]byte(secretKey))
	if err != nil {
		log.Println("❌ ERROR: Failed to sign JWT token:", err)
		return "", err
	}

	log.Println("✅ JWT token successfully generated")
	return signedToken, nil
}

// Function to authenticate with Tableau
func tableauSignIn(w http.ResponseWriter, r *http.Request) {
	// Read request body
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		log.Println("❌ ERROR: Failed to read request body:", err)
		http.Error(w, "Failed to read request body", http.StatusInternalServerError)
		return
	}

	// Log the request body
	log.Printf("Received body: %s", string(body))

	// Reset request body for further processing
	r.Body = ioutil.NopCloser(bytes.NewReader(body))

	// Decode JSON request into TsRequest struct
	var tsRequest TsRequest
	err = json.NewDecoder(r.Body).Decode(&tsRequest)
	if err != nil {
		log.Println("❌ ERROR: Failed to parse JSON request body:", err)
		http.Error(w, "Invalid JSON request body", http.StatusBadRequest)
		return
	}

	// Ensure required fields are present
	if tsRequest.Credentials.PersonalAccessTokenName == "" || tsRequest.Credentials.PersonalAccessTokenSecret == "" {
		log.Println("❌ ERROR: Missing personal access token name or secret in request")
		http.Error(w, "Missing personal access token name or secret", http.StatusBadRequest)
		return
	}

	log.Println("🔹 Authenticating with Tableau using personal access token")

	// Set the Tableau site content URL
	tsRequest.Credentials.Site.ContentUrl = "embedseubl"

	// Convert request struct to JSON
	jsonData, err := json.Marshal(tsRequest)
	if err != nil {
		log.Println("❌ ERROR: Failed to marshal JSON:", err)
		http.Error(w, "Failed to process JSON request", http.StatusInternalServerError)
		return
	}

	// Send authentication request to Tableau API
	resp, err := http.Post("https://us-west-2b.online.tableau.com/api/3.22/auth/signin",
		"application/json", bytes.NewBuffer(jsonData))

	if err != nil {
		log.Println("❌ ERROR: Failed to send request to Tableau:", err)
		http.Error(w, "Failed to authenticate with Tableau", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Read response from Tableau
	body, _ = ioutil.ReadAll(resp.Body)
	log.Println("📩 Tableau Response:", string(body))

	// Check for authentication failure
	if resp.StatusCode != http.StatusOK {
		log.Println("❌ ERROR: Tableau authentication failed with status:", resp.Status)
		http.Error(w, "Tableau authentication failed", resp.StatusCode)
		return
	}

	// Generate JWT token
	jwtToken, err := generateJWT()
	if err != nil {
		log.Println("❌ ERROR: Failed to generate JWT token")
		http.Error(w, "Failed to generate JWT token", http.StatusInternalServerError)
		return
	}

	log.Println("✅ Authentication successful, sending JWT token")

	// Send JWT token as response
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(fmt.Sprintf(`{"jwtToken": "%s"}`, jwtToken)))
}

func main() {
	// Load environment variables from .env file
	err := godotenv.Load()
	if err != nil {
		log.Fatal("❌ ERROR: Failed to load .env file")
	}

	// Configure CORS policy
	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000"}, // Define allowed frontend URL
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE"},
		AllowedHeaders: []string{"Content-Type"},
	})

	// Define route handler for Tableau authentication
	http.HandleFunc("/tableau-signin", tableauSignIn)

	// Wrap HTTP server with CORS middleware
	handler := corsHandler.Handler(http.DefaultServeMux)

	// Get port from environment variable or default to 5000
	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	log.Println("🚀 Server running on port", port)

	// Start the HTTP server
	err = http.ListenAndServe(":"+port, handler)
	if err != nil {
		log.Fatal("❌ ERROR: Failed to start server:", err)
	}
}
