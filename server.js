const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3333;

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true,
}));
app.use(bodyParser.json());


// Load users from CSV
function loadUsersFromCSV() {
    return new Promise((resolve, reject) => {
        const users = [];
        const filePath = path.join(__dirname, 'users.csv'); // Ensure correct path

        fs.createReadStream(filePath)
            .pipe(csv({ headers: false }))
            .on('data', (row) => {
                const [email, password] = Object.values(row);
                users.push({ email, password }); // Store as objects
            })
            .on('end', () => resolve(users))
            .on('error', (err) => reject(err));
    });
}

// Generate JWT Token for Tableau
function generateTableauJWT(username) {
    const tokenPayload = {
        iss: process.env.CONNECTED_APP_CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 300, // 5 mins expiry
        jti: uuidv4(),
        aud: "tableau",
        sub: username,
        scp: [
            "tableau:content:read",
            "tableau:datasources:create",
            "tableau:datasources:update",
            "tableau:datasources:download",
            "tableau:tasks:run",
            "tableau:projects:*",
            'tableau:views:embed',
            'tableau:views:embed_authoring',
            'tableau:metrics:embed',
            'tableau:insights:embed',
        ]
    };

    const jwtOptions = {
        algorithm: "HS256",
        header: {
            kid: process.env.CONNECTED_APP_SECRET_ID,
            iss: process.env.CONNECTED_APP_CLIENT_ID
        }
    };

    const jwtToken = jwt.sign(tokenPayload, process.env.CONNECTED_APP_SECRET_KEY, jwtOptions);
    return jwtToken;
}


// https://us-west-2b.online.tableau.com/api/3.22/auth/signin

// Tableau sign-in route
app.post('/tableau-signin', async (req, res) => {
    const { username, password } = req.body;

    try {
        const users = await loadUsersFromCSV();
        const user = users.find(u => u.email === username && u.password === password);

        if (!user) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // Generate the Tableau JWT
        const jwtToken = generateTableauJWT(username);
        console.log("signin-Generated JWT:", jwtToken);

        // Prepare body for Tableau authentication request
        const authBody = {
            credentials: {
                jwt: jwtToken,
                site: {
                    contentUrl: process.env.TS_SITE_URL
                }
            }
        };

        // Send the POST request to Tableau to sign in
        console.log('Sending request to Tableau:', JSON.stringify(authBody, null, 2));

        const tsUrl = `https://${process.env.TS_SERVER}/api/3.22/auth/signin`;
        console.log("tsUrl", tsUrl)
        const headers = {
            'Content-Type': 'application/json'
        };

        try {
            
            let tableauResponse;  // Define the variable outside the try/catch

            try {
                tableauResponse = await axios.post(tsUrl, authBody, { headers });
                console.log('Tableau response1:', tableauResponse.data);
            } catch (err) {
                console.error('Error during Tableau authentication:', err.response?.data || err.message);
                return res.status(500).json({ message: 'Failed to authenticate with Tableau', error: err.response?.data || err.message });
            }
            const responseData = tableauResponse.data.credentials;
            console.log('Tableau response2:', tableauResponse.data);
            
            const tsSiteLuid = responseData.site.id;
            const tsAuthToken = responseData.token;
            const tsUserLuid = responseData.user.id;

            const tsAuthInfo = {
                ts_username_to_impersonate: username,
                ts_user_luid: tsUserLuid,
                ts_site_luid: tsSiteLuid,
                ts_auth_token: tsAuthToken,
                ts_project: req.body.ts_project
            };

            console.log("Authentication info:", tsAuthInfo);
            return res.json({ tsAuthInfo, jwtToken }); // Return both in an object

        } catch (err) {
            console.error('Error during Tableau authentication:', err.message);
            return res.status(500).json({ message: 'Failed to authenticate with Tableau', error: err.message });
        }

    } catch (error) {
        console.error('Error reading CSV:', error);
        res.status(500).json({ message: 'Authentication failed', error: error.message });
    }
});


// Fetch Projects from Tableau
app.get('/tableau-folders', async (req, res) => {
    const tableauToken = req.headers['authorization'];
    const siteId = process.env.SITEID

    console.log('Received Tableau Token in Backend:', tableauToken); // Check token here

    if (!tableauToken) {
        console.log("Missing authentication tokens.");
        return res.status(401).json({ message: "Missing authentication tokens." });
    }
    

    try {
        const response = await axios.get(`https://us-west-2b.online.tableau.com/api/3.22/sites/${siteId}/projects?filter=name:eq:exelixis`, {
            headers: {
                'X-Tableau-Auth': tableauToken,
                'Content-Type': 'application/json'
            },
        });
        const topLevelProjects = response.data.projects.project;
        
        // Fetch subprojects recursively
        const nestedProjects = await getNestedProjects(topLevelProjects, siteId, tableauToken);
        console.log("nestedProjects", nestedProjects)

        res.json({ 
            rawData: response.data,  // Original API response
            nestedProjects: nestedProjects // Your nested structure
        });
        } catch (error) {
        console.error('Error Fetching Projects:', error.message);
        res.status(500).json({ message: 'Failed to fetch projects', error: error.message });
    }
});

// Recursively fetch nested projects
async function getNestedProjects(projects, siteId, token) {
    for (const project of projects) {
        const subprojects = await fetchSubprojects(project.id, siteId, token);
        if (subprojects.length > 0) {
            project.children = await getNestedProjects(subprojects, siteId, token);
        }
    }
    console.log("projects", projects)
    return projects;
}

// Fetch projects within a given parent project
async function fetchSubprojects(parentProjectId, siteId, token) {
    try {
        const response = await axios.get(`https://us-west-2b.online.tableau.com/api/3.22/sites/${siteId}/projects?filter=parentProjectId:eq:${parentProjectId}`, {
            headers: {
                'X-Tableau-Auth': token,
                'Content-Type': 'application/json'
            }
        });

        return response.data.projects.project || [];
    } catch (error) {
        console.error(`Error fetching subprojects for ${parentProjectId}:`, error.message);
        return [];
    }
}

// // Fetch views from Tableau
app.get('/tableau-views', async (req, res) => {
    const tableauToken = req.headers['authorization'];
    const siteId = process.env.SITEID;
    const filterValue = req.query.filter || 'CEO';

    if (!tableauToken) {
        return res.status(401).json({ message: "Missing authentication tokens." });
    }
    try {
        const viewsResponse = await axios.get(
            `https://us-west-2b.online.tableau.com/api/3.22/sites/${siteId}/views?filter=projectName:eq:${filterValue}`,
            {
                headers: {
                    'X-Tableau-Auth': tableauToken,
                    'Content-Type': 'application/json'
                },
            }
        );
        const views = viewsResponse.data.views.view;
        const images = await Promise.all(
            views.map(async (view) => {
                const { id: viewId, workbook } = view;
                const workbookId = workbook.id;
                try {
                    const previewResponse = await axios.get(
                        `https://us-west-2b.online.tableau.com/api/3.22/sites/${siteId}/workbooks/${workbookId}/views/${viewId}/previewImage`,
                        {
                            headers: {
                                'X-Tableau-Auth': tableauToken,
                                'Content-Type': 'application/json'
                            },
                            responseType: 'arraybuffer'
                        }
                    );
                    const base64Image = `data:image/png;base64,${Buffer.from(previewResponse.data, 'binary').toString('base64')}`;
                    return { viewId, previewImage: base64Image };
                } catch (error) {
                    console.error(`❌ Error fetching preview for view ${viewId}:`, error.message);
                    return { viewId, previewImage: null };
                }
            })
        );

        res.json({
            views,   // Original views, untouched
            images   // Separate image array, matching by viewId
        });

    } catch (error) {
        console.error('Error Fetching views:', error.message);
        res.status(500).json({ message: 'Failed to fetch views', error: error.message });
    }
});


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));