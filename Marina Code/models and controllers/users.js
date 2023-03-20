const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const ds = require('./datastore');
const datastore = ds.datastore;

const USER = "User";

router.use(bodyParser.json());

/* ------------- Begin User Model Functions ------------- */

// This function gets all users
async function get_users() {
    const q = datastore.createQuery(USER); 
    users = await datastore.runQuery(q);
    return users[0].map(ds.fromDatastore);
}

/* ------------- End User Model Functions ------------- */

/* ------------- Begin User Controller Functions ------------- */

router.get('/', async function (req, res) {
    try{
        let all_users = await get_users(req);
        res.status(200).json(all_users);
    } catch(error) {
        console.error(error);
    }
});

/* ------------- End User Controller Functions ------------- */

module.exports = router;