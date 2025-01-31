const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',  
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));
app.use(bodyParser.json());

// Endpoint to handle Tableau sign-in and JWT token generation
app.post('/tableau-signin', async (req, res) => {
    console.log('Received request body:', req.body); // Log the entire body

    const { personalAccessTokenName, personalAccessTokenSecret } = req.body.credentials; 
    console.log('Received login request:', { personalAccessTokenName, personalAccessTokenSecret }); // Log the received credentials


    try {
        // Request Tableau authentication
        const tableauResponse = await axios.post('https://us-west-2b.online.tableau.com/api/3.22/auth/signin', 
            `<tsRequest>
                <credentials personalAccessTokenName="${personalAccessTokenName}" personalAccessTokenSecret="${personalAccessTokenSecret}">
                    <site contentUrl="embedseubl"/>
                </credentials>
            </tsRequest>`, 
            {
                headers: {
                    'Content-Type': 'application/xml'
                }
            });

        console.log('Tableau authentication response:', tableauResponse.data); // Log Tableau response

        if (!tableauResponse.data.credentials) {
            console.error('No credentials found in Tableau response');
            return res.status(500).json({ message: 'Tableau authentication failed' });
        }

        const tableauToken = tableauResponse.data.credentials.token;
        console.log('Tableau Token:', tableauToken); // Log the received Tableau token

        // Create JWT payload
        const tokenPayload = {
            iss: process.env.CONNECTED_APP_CLIENT_ID,
            exp: Math.floor(Date.now() / 1000) + (5 * 60), // Token valid for 5 minutes
            jti: uuidv4(),
            aud: "tableau",
            sub: "abierschenk@salesforce.com",
            scp: ["tableau:views:embed", "tableau:metrics:embed"],
            "https://tableau.com/oda": "true",
            "https://tableau.com/groups": ["odatest"],
        };

        console.log('JWT Payload:', tokenPayload); // Log the payload for the JWT

        // JWT signing options
        const jwtOptions = {
            algorithm: "HS256",
            header: {
                kid: process.env.CONNECTED_APP_SECRET_ID,
                iss: process.env.CONNECTED_APP_CLIENT_ID
            }
        };

        // Generate JWT token
        const jwtToken = jwt.sign(tokenPayload, process.env.CONNECTED_APP_SECRET_KEY, jwtOptions);
        console.log('Generated JWT Token:', jwtToken); // Log the generated JWT token

        res.json({ jwtToken });

    } catch (error) {
        console.error('Authentication error:', error.message);
        res.status(500).json({ message: 'Failed to authenticate with Tableau', error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
