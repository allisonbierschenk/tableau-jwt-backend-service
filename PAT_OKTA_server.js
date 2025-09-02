const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken'); 
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3333;

// Middleware
app.use(cors({
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));
app.use(bodyParser.json());

// Redirect user to Okta login
app.get('/login', (req, res) => {
    const oktaAuthUrl = `${process.env.OKTA_ISSUER}/v1/authorize?` +
        `client_id=${process.env.OKTA_CLIENT_ID}&` +
        `response_type=code&` +
        `scope=tableau:views:embed&` +
        `redirect_uri=${process.env.OKTA_REDIRECT_URI}&` +
        `state=random_state_value`;

    res.redirect(oktaAuthUrl);
});

// Handle Okta callback and exchange code for JWT
app.get('/authorization-code/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).json({ message: 'Missing authorization code' });
    }

    try {
        const tokenResponse = await axios.post(
            `${process.env.OKTA_ISSUER}/v1/token`,
            new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: process.env.OKTA_CLIENT_ID,
                client_secret: process.env.OKTA_CLIENT_SECRET,
                redirect_uri: process.env.OKTA_REDIRECT_URI,
                code: code
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token } = tokenResponse.data;
        console.log("✅ access token", access_token)

        const redirectUrl = `http://localhost:3000/dashboard?token=${access_token}`;
        console.log("🔄 Redirecting to:", redirectUrl);
        res.redirect(redirectUrl);

    } catch (error) {
        console.error('❌ Error exchanging code for token:', error.message);
        res.status(500).json({ message: 'Failed to authenticate', error: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
