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

// JSON structure for Tableau authentication request
type TsRequest struct {
	Credentials struct {
		Name     string `json:"name"`      // Use 'name' instead of 'username'
		Password string `json:"password"`
		Site     struct {
			ContentUrl string `json:"contentUrl"`
		} `json:"site"`
	} `json:"credentials"`
}

// Generate JWT token
func generateJWT() (string, error) {
	// Define JWT claims
	claims := jwt.MapClaims{
		"iss": os.Getenv("CONNECTED_APP_CLIENT_ID"),
		"exp": time.Now().Add(5 * time.Minute).Unix(),
		"jti": uuid.New().String(),
		"aud": "tableau",
		"sub": "abierschenk@salesforce.com",
		"scp": []string{"tableau:views:embed", "tableau:metrics:embed"},
		"https://tableau.com/oda": true,
		"https://tableau.com/groups": "odatest",
	}

	// Create JWT token with signing method
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	// Set header options
	token.Header["kid"] = os.Getenv("CONNECTED_APP_SECRET_ID")
	token.Header["iss"] = os.Getenv("CONNECTED_APP_CLIENT_ID")

	// Sign the token
	secretKey := os.Getenv("CONNECTED_APP_SECRET_KEY")
	if secretKey == "" {
		log.Println("❌ ERROR: CONNECTED_APP_SECRET_KEY is not set.")
		return "", fmt.Errorf("missing CONNECTED_APP_SECRET_KEY")
	}

	signedToken, err := token.SignedString([]byte(secretKey))
	if err != nil {
		log.Println("❌ ERROR: Failed to sign JWT token:", err)
		return "", err
	}

	log.Println("✅ JWT token successfully generated")
	return signedToken, nil
}

// Tableau authentication function
func tableauSignIn(w http.ResponseWriter, r *http.Request) {
	// Read the raw request body to log it
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		log.Println("❌ ERROR: Failed to read request body:", err)
		http.Error(w, "Failed to read request body", http.StatusInternalServerError)
		return
	}

	// Log the received body
	log.Printf("Received body: %s", string(body))

	// Rewind the body so it can be read by the JSON decoder
	r.Body = ioutil.NopCloser(bytes.NewReader(body))

	// Parse the JSON request body into TsRequest
	var tsRequest TsRequest
	err = json.NewDecoder(r.Body).Decode(&tsRequest)
	if err != nil {
		log.Println("❌ ERROR: Failed to parse JSON request body:", err)
		http.Error(w, "Invalid JSON request body", http.StatusBadRequest)
		return
	}

	// Check if credentials are provided
	if tsRequest.Credentials.Name == "" || tsRequest.Credentials.Password == "" {
		log.Println("❌ ERROR: Missing username or password in request")
		http.Error(w, "Missing username or password", http.StatusBadRequest)
		return
	}

	log.Println("🔹 Authenticating with Tableau for user:", tsRequest.Credentials.Name)

	// Convert the request to JSON format for Tableau API
	tsRequest.Credentials.Site.ContentUrl = "eacloud"  // Set your actual site content URL

	// Marshal the request into JSON
	jsonData, err := json.Marshal(tsRequest)
	if err != nil {
		log.Println("❌ ERROR: Failed to marshal JSON:", err)
		http.Error(w, "Failed to process JSON request", http.StatusInternalServerError)
		return
	}

	// Send authentication request to Tableau (XML still required by Tableau API)
	resp, err := http.Post("https://us-west-2b.online.tableau.com/api/3.22/auth/signin",
		"application/json", bytes.NewBuffer(jsonData))

	if err != nil {
		log.Println("❌ ERROR: Failed to send request to Tableau:", err)
		http.Error(w, "Failed to authenticate with Tableau", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Read the Tableau API response
	body, _ = ioutil.ReadAll(resp.Body)
	log.Println("📩 Tableau Response:", string(body))

	// Check if authentication failed
	if resp.StatusCode != http.StatusOK {
		log.Println("❌ ERROR: Tableau authentication failed with status:", resp.Status)
		http.Error(w, "Tableau authentication failed", resp.StatusCode)
		return
	}

	// Generate JWT token after successful Tableau auth
	jwtToken, err := generateJWT()
	if err != nil {
		log.Println("❌ ERROR: Failed to generate JWT token")
		http.Error(w, "Failed to generate JWT token", http.StatusInternalServerError)
		return
	}

	log.Println("✅ Authentication successful, sending JWT token")

	// Send JWT token as JSON response
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(fmt.Sprintf(`{"jwtToken": "%s"}`, jwtToken)))
}

func main() {
	// Load environment variables from .env file
	err := godotenv.Load()
	if err != nil {
		log.Fatal("❌ ERROR: Failed to load .env file")
	}

	// Set up CORS middleware
	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000"}, // Add your frontend URL here
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE"},
		AllowedHeaders: []string{"Content-Type"},
	})

	// Set up the HTTP route
	http.HandleFunc("/tableau-signin", tableauSignIn)

	// Wrap the handler with CORS middleware
	handler := corsHandler.Handler(http.DefaultServeMux)

	// Start the server
	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}
	log.Println("🚀 Server running on port", port)
	err = http.ListenAndServe(":"+port, handler)
	if err != nil {
		log.Fatal("❌ ERROR: Failed to start server:", err)
	}
}
