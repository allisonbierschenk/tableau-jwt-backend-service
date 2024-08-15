const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: 'http://localhost:3000',  
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Tableau-Auth'],
}));
app.use(bodyParser.json());

app.post('/tableau-signin', async (req, res) => {
    try {
        const tableauResponse = await axios.post('https://us-west-2b.online.tableau.com/api/3.22/auth/signin', 
            `<tsRequest>
                <credentials name="abierschenk@salesforce.com" password="Allson!q2w3e4r5t">
                    <site contentUrl="eacloud"/>
                </credentials>
            </tsRequest>`, 
            {
                headers: {
                    'Content-Type': 'application/xml'
                }
            });

        const tableauToken = tableauResponse.data.credentials.token;

        const tokenPayload = {
            iss: process.env.CONNECTED_APP_CLIENT_ID,
            exp: Math.floor(Date.now() / 1000) + (5 * 60),
            jti: uuidv4(),
            aud: "tableau",
            sub: "abierschenk@salesforce.com",
            scp: ["tableau:views:embed", "tableau:metrics:embed"]
        
        };

        const jwtOptions = {
            algorithm: "HS256",
            header: {
                kid: process.env.CONNECTED_APP_SECRET_ID,
                iss: process.env.CONNECTED_APP_CLIENT_ID
            }
        };

        const jwtToken = jwt.sign(tokenPayload, process.env.CONNECTED_APP_SECRET_KEY, jwtOptions);

        res.json({ jwtToken });
    } catch (error) {
        res.status(500).json({ message: 'Failed to authenticate with Tableau', error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
