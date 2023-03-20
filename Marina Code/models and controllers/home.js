const express = require('express');
const { engine } = require ('express-handlebars');

const app = express();
app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.set("views", "./views");

const bodyParser = require('body-parser');
const axios = require('axios');

const ds = require('./datastore');
const datastore = ds.datastore;

const router = express.Router();

const USER = "User";

// Used uuid to generate a random state variable
const uuid = require("uuid");
const STATE = "State";
const clientId = "346218001486-lt8v9vsimvrlkgoornohjmo5f4ffin56.apps.googleusercontent.com"; 
const clientSecret = "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";
//const redirectUri = "http://localhost:8080/oauth";
const redirectUri = "https://cs-493-portfolio-tiua.uc.r.appspot.com/oauth";

app.use(bodyParser.json());

// This function saves the state in the datastore
async function save_state(state) {
    const key = datastore.key(STATE); 
    const new_state = { "state": state};

    try {
        await datastore.save({"key": key, "data": new_state});
    } catch (error) {
        console.error(error);
    }
}

// This function verifies the state returned exists in the datastore
async function verify_state(state) {
    const q = datastore.createQuery(STATE);
    try {
        const states = await datastore.runQuery(q);
        for (let i = 0; i < states[0].length; i++) {
            if (states[0][i].state === state) {
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error(error);
    }
}

// This function returns whether the user exists already in the datastore
async function user_exists(unique_id) {
    const q = datastore.createQuery(USER);
    try {
        const users = await datastore.runQuery(q);
        for (let i = 0; i < users[0].length; i++) {
            if (users[0][i].unique_id === unique_id) {
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error(error);
    }
}

// This function saves the user in the datastore
async function post_user(unique_id, first_name, last_name) {
    const key = datastore.key(USER); 
    const new_user = { "unique_id": unique_id, "first_name": first_name, "last_name": last_name};

    try {
        await datastore.save({"key": key, "data": new_user});
    } catch (error) {
        console.error(error);
    }
}

/* ------------- Begin Controller Functions ------------- */
app.get('/', function (req, res) {
    res.render('home');
});

// When user presses submit button sends a request that redirects the user to the endpoint to authorize Google OAuth 2.0
app.get('/oauth_redirect', async function(req, res) {
    const new_state = uuid.v4();

    // Save the generated state in the datastore
    try {
        await save_state(new_state);
    } catch (error) {
        console.error(error);
    }

    // Redirect the user to the authentication page
    const auth_url = "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=" + clientId + '&redirect_uri=' + redirectUri + '&scope=profile&state=' + new_state;
    res.redirect(307, auth_url);
})

// Get the access code returned to request data
app.get('/oauth', async function(req, res) {
    // verify state
    var context = {};
    state_exists = await verify_state(req.query.state);

    if (state_exists) {
        // First send a POST request to get the access token
        // console.log("Sending Axios Request...")
        const tokenResponse = await axios({
            method: 'post',
            url: 'https://oauth2.googleapis.com/token',
            headers: {'Accept-Encoding' : 'application/json'},
            data: {
                code: req.query.code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            }
        });

        const token_type = tokenResponse.data.token_type;
        const access_token = tokenResponse.data.access_token;

        // Then send a get request to the People API using token
        const profileResponse = await axios({
            method: 'get',
            headers: {'Accept-Encoding' : 'application/json'},
            url: 'https://people.googleapis.com/v1/people/me?personFields=names',
            headers: {
                'Authorization' : token_type + ' ' + access_token
            }
        });

        sub = profileResponse.data.resourceName.substring(7);
        first_name = profileResponse.data.names[0].givenName;
        last_name = profileResponse.data.names[0].familyName;

        
        context.first_name = first_name;
        context.last_name = last_name;
        context.unique_id = sub;
        context.token = tokenResponse.data.id_token;

        // If the user does not already exist in the datastore, then post thte user
        existing_user = await user_exists(sub);
        
        if (!existing_user) {
            await post_user(sub, first_name, last_name);
        }

        res.render('data_page', context);
    }
});

/* ------------- End Controller Functions ------------- */

module.exports = router;
module.exports = app; 