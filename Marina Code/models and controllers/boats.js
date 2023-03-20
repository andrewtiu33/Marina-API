const express = require('express');
const json2html = require('json-to-html');
const bodyParser = require('body-parser');
const router = express.Router();
const ds = require('./datastore');
const { functions } = require('lodash');
const { Datastore } = require('@google-cloud/datastore');
const { all } = require('./loads');

const datastore = ds.datastore;

const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require('jwks-rsa');

const BOAT = "Boat";
const LOAD = "Load";


router.use(bodyParser.json());

const checkJwt = jwt({
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: 'https://www.googleapis.com/oauth2/v3/certs'
    }),
  
    // Validate the audience and the issuer.
    issuer: `https://accounts.google.com`,
    algorithms: ['RS256']
  });

/* ------------- Begin Boat Model Functions ------------- */
// Model handles saving and loading properties to the database
// This function creates a new boat
async function post_boat(name, type, length, owner) {
    const key = datastore.key(BOAT); 
    const new_boat = { "name": name, "type": type, "length": length, "owner": owner, "loads": []} ;
    try {
        await datastore.save({"key": key, "data": new_boat}) ;
        return key;

    } catch (error) {
        console.error(error);
    }
}

// This function checks if the name given in the request is unique
async function unique_name(name, id) {
    const q = datastore.createQuery(BOAT);
    //console.log("ID");
    //console.log(id);
    //console.log("NAME");
    //console.log(name);
    try {
        const boats = await datastore.runQuery(q);

        // Check if the name is not unique by comparing name and making sure ID is different
        for (let i = 0; i < boats[0].length; i++) {
            // Case where an id is not given (post situation)
            if (id === undefined) {
                if (boats[0][i].name.toLowerCase() == name.toLowerCase()) {
                    return false;
                } 
            }
            // Case where a name and id is given (put situation)
            if (boats[0][i].name.toLowerCase() == name.toLowerCase() && id != boats[0][i][Datastore.KEY].id) {
                return false;
            }  
        }

        return true;

    } catch (error) {
        console.error(error);
    }
}

// This function gets all the boats belonging to the owner id given
async function get_owner_boats(req) {
    let q = datastore.createQuery(BOAT).limit(5);

    let results = {}; 
    if(Object.keys(req.query).includes("cursor")){
        q = q.start(req.query.cursor);
    }

    let boats = await datastore.runQuery(q);
    let q2 = datastore.createQuery(BOAT).filter('owner', '=', req.auth.sub);
    total = await datastore.runQuery(q2);
    results.total_boats = total[0].length;
    results.boats = boats[0].map(ds.fromDatastore).filter(item => item.owner === req.auth.sub);
    if (boats[1].moreResults !== ds.Datastore.NO_MORE_RESULTS) {
        results.next = req.protocol + "://" + req.get("host") + req.baseUrl + "?cursor=" + boats[1].endCursor;
        }
    return results;

}

// This function gets the data of a single boat from the database
async function get_boat(id) {
    const key = datastore.key([BOAT, parseInt(id, 10)]);
    try {
        const entity = await datastore.get(key);
        if (entity[0] === undefined || entity[0] === null) {
            // No entity found. Don't try to add the id attribute.
            return entity;
        } else {
            // Entity found. Adds id attribute to every element in the array entity
            return entity.map(ds.fromDatastore);
        }
    } catch (error) {
        console.error(error);
    }
}

// This function edits the data of a single boat from the database
async function edit_boat(id, name, type, length, owner) {
    const key = datastore.key([BOAT, parseInt(id, 10)]);
    const boat_to_edit = await datastore.get(key);
    const edited_boat = {};

    // Case where the boat does not exist
    if (boat_to_edit[0] === undefined || boat_to_edit[0] === null) {
        return 404;
    }

    if (boat_to_edit[0].owner != owner) {
        return 403;
    } else {
        edited_boat.owner = owner;
    }

    edited_boat.loads = boat_to_edit[0].loads;

    // Set the name, type, length attributes if they were given and if not set to default
    if (name) {
        edited_boat.name = name;
    } else {
        edited_boat.name = boat_to_edit[0].name;
    }

    if (type) {
        edited_boat.type = type;
    } else {
        edited_boat.type = boat_to_edit[0].type;
    }

    if (length) {
        edited_boat.length = length;
    } else {
        edited_boat.length = boat_to_edit[0].length;
    }

    try {
        await datastore.save({ "key" : key, "data" : edited_boat});
        return edited_boat;

    } catch(error) {
        console.error(error);
    }
}

// This function deletes a boat from the database.
async function delete_boat(id, owner) {
    const boat_key = datastore.key([BOAT, parseInt(id, 10)]);
    const q = datastore.createQuery(LOAD);

    try {
        const boat = await datastore.get(boat_key);

        // Case where the boat does not exist
        if (boat[0] === undefined || boat[0] === null) {
            return 404;
        }

        // Case where the boat does not belong to the one making the request
        if (boat[0].owner != owner) {
            return 403;
        }

        const loads = await datastore.runQuery(q);

        // Update the carrier attributes of loads being carried by deleted boat to be null
        for (let i = 0; i < loads[0].length; i++) {
            if (loads[0][i].carrier != null && loads[0][i].carrier.id == id) {
                const load_key = datastore.key([LOAD, parseInt(loads[0][i][Datastore.KEY].id, 10)]);
                        
                    loads[0][i].carrier = null;
                    await datastore.save({"key": load_key, "data": loads[0][i]});
                }
        }

        await datastore.delete(boat_key);
        return 204;

    } catch (error) {
        console.error(error);
    }
}

// This function assigns a load to a boat. 
async function assign_load(boat_id, load_id, owner) {
    const boat_key = datastore.key([BOAT, parseInt(boat_id, 10)]);
    const load_key = datastore.key([LOAD, parseInt(load_id, 10)]);

    try {
        const boat = await datastore.get(boat_key);
        const load = await datastore.get(load_key);

        // Case where the boat and/or load doesn't exist
        if (boat[0] === undefined || boat[0] === null || load[0] === undefined || load[0] === null) {
            return 404;
        }

        // Case where the owner of the JWT is not the owner of the boat
        if (boat[0].owner != owner) {
            return 401;
        }
        
        // Case where the load is already loaded on another boat
        if (load[0].carrier) {
            
            return 403;

        }

        boat[0].loads.push({"id": load_id}); 
        load[0].carrier = { "id": boat_id, "name": boat[0].name};
        await datastore.save({"key": boat_key, "data": boat[0]});
        await datastore.save({"key": load_key, "data": load[0]});
        return 204;

    } catch (error) {
        console.error(error); 
    }

}

// This function removes a load from a boat
async function remove_load(boat_id, load_id, owner) {
    const boat_key = datastore.key([BOAT, parseInt(boat_id, 10)]);
    const load_key = datastore.key([LOAD, parseInt(load_id, 10)]);

    try {
        const boat = await datastore.get(boat_key);
        const load = await datastore.get(load_key);

        // Case where the boat and/or load doesn't exist
        if (boat[0] === undefined || boat[0] === null || load[0] === undefined || load[0] === null) {
            return 404;
        }

        // Case where the load is not on this boat
        if (load[0].carrier === null || load[0].carrier === undefined) {
            return 404;
        }

        // Case where the owner of the JWT is not the owner of the boat
        if (boat[0].owner != owner) {
            return 403;
        }

        // Remove the load from the boat's loads
        for (let i = 0; i < boat[0].loads.length; i++) {
            if (boat[0].loads[i].id == load_id) {
                boat[0].loads.splice(i, 1);
            }
        }

        // Remove the boat from the load's carrier
        load[0].carrier = null;

        await datastore.save({"key": boat_key, "data": boat[0]});
        await datastore.save({"key": load_key, "data": load[0]});
        return 204;

    } catch (error) {
        console.error(error);
    }
}


/* ------------- End Boat Model Functions ------------- */

/* ------------- Begin Boat Controller Functions ------------- */
router.post('/', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        // console.log(err)
        return res.status(401).send('JWT is invalid / missing.');
        
    } else {
        next('route');
    }

});

router.post('/', async function(req, res) {
    // Check if request is json
    if (req.get('content-type') !== 'application/json') {
        return res.status(415).json({'Error': 'Server only accepts application/json data.'})
    }

    // Check if any of the 3 required attributes are missing and if one is missing return status code 400
    if (req.body.name == null || req.body.type == null || req.body.length == null) {
        return res.status(400).json( {'Error' : 'The request object is missing at least one of the required attributes.'});
    }

    // Check if the name is not unique 
    unique = await unique_name(req.body.name);
    if (!(unique)) {
        return res.status(403).json( {'Error' : 'The name given is not unique and already exists.'});
    }

    // Check if the response is json
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        return res.status(406).json({'Error': 'The requested response content type is not supported.'});
    } else if(accepts === 'application/json'){
        const key = await post_boat(req.body.name, req.body.type, req.body.length, req.auth.sub);

        // Check if the boat exists
        if (key == 404) {
            return res.status(404).json( {'Error' : 'No boat with this boat_id exists.'})
        }
        
        res.status(201).send({
            "id": key.id, 
            "name": req.body.name, 
            "type": req.body.type, 
            "length": req.body.length,
            "owner": req.auth.sub,
            "loads": [],
            "self": req.protocol + "://" + req.get("host") + req.baseUrl + "/" + key.id
        })
    } else { res.status(500).send('Content type got messed up!'); }
});

router.get('/', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        return res.status(401).send('JWT is invalid / missing.');
    } else {
        next('route');
    }
});

router.get('/', async function(req, res) {
    try {
        let results = await get_owner_boats(req);
        let boats = results.boats;

        // Add the self link to the boats
        for(let i = 0; i < boats.length; i++) {
            let current_boat = boats[i];
            current_boat.self = req.protocol + "://" + req.get("host") + "/boats/" + current_boat.id;
        }

        res.status(200).json(results);

    } catch(error) {
        console.error(error);
    }
});

router.get('/:boat_id', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        return res.status(401).send('JWT is invalid / missing.');
    } else {
        next('route');
    }
});

router.get('/:boat_id', async function(req, res) {
    try{
        const boat = await get_boat(req.params.boat_id);
    
        if (boat[0] === undefined || boat[0] === null) {
            // If the 0th element is undefined, there is no boat with this id
            return res.status(404).json({ 'Error': 'No boat with this boat_id exists.'});
        } else if (boat[0].owner != req.auth.sub) {
            return res.status(403).json({ 'Error': 'You are not authorized to view this boat.'});
        }
        else {
            const accepts = req.accepts(['application/json', 'text/html']);
            boat[0].self = req.protocol + "://" + req.get("host") + req.baseUrl + "/" + req.params.boat_id;
            for (let i = 0; i < boat[0].loads.length; i++) {
                let current_load = boat[0].loads[i];
                current_load.self = req.protocol + "://" + req.get("host") + "/loads/" + current_load.id;
            }
            if(!accepts){
                return res.status(406).json({'Error': 'The requested response content type is not supported.'});
            } else if(accepts === 'application/json'){
                return res.status(200).json(boat[0]);
            } else { return res.status(500).send('Content type got messed up!'); }
        }
            
    } catch(error) {
        console.error(error);
    }
});

router.patch('/:boat_id', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        return res.status(401).send('JWT is invalid / missing.');
    } else {
        next('route');
    }
});

router.patch('/:boat_id', async function(req, res) {
    // Check if request's MIME type is not suppoted
    if (req.get('content-type') !== 'application/json') {
        return res.status(415).json({'Error': 'Server only accepts application/json data.'})
    }

    // Check if all of the 3 attributes are missing 
    if (req.body.name === undefined && req.body.type === undefined && req.body.length === undefined) {
            return res.status(400).json( {'Error' : 'The request object is missing required attributes.'});
    }
    
    // Check if the name is unique
    if (req.body.name) {
        if (!(await unique_name(req.body.name))) {
            return res.status(403).json( {'Error' : 'The name given is not unique and already exists.'});
        }
    }

    // Check if the response is json
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        res.status(406).json({'Error': 'The requested response content type is not supported.'});
    } else if(accepts === 'application/json'){
        
        const boat = await edit_boat(req.params.boat_id, req.body.name, req.body.type, req.body.length, req.auth.sub);

        if (boat == 404) {
            return res.status(404).json( {'Error' : 'No boat with this boat_id exists.'})
        }

        if (boat == 403) {
            return res.status(403).json( {'Error' : 'You are not authorized to edit this boat.'})
        }

        edited_boat = await get_boat(req.params.boat_id);
        edited_boat[0].self = req.protocol + "://" + req.get("host") + req.baseUrl + "/" + req.params.boat_id;
        return res.status(200).json(edited_boat[0]);

    } else { res.status(500).send('Content type got messed up!'); }

});

router.put('/:boat_id', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        return res.status(401).send('JWT is invalid / missing.');
    } else {
        next('route');
    }
});

router.put('/:boat_id', async function(req, res) {
    // Check if request's MIME type is not suppoted
    if (req.get('content-type') !== 'application/json') {
        return res.status(415).json({'Error': 'Server only accepts application/json data.'})
    }

    // Check if any of the 3 required attributes are missing 
    if (req.body.name === null || req.body.name === undefined || req.body.type === null || req.body.type === undefined ||
        req.body.length === null || req.body.length === undefined) {
            return res.status(400).json( {'Error' : 'The request object is missing required attributes.'});
    }
    
    // Check if the name is unique
    if (!(await unique_name(req.body.name, req.params.boat_id))) {
        return res.status(403).json( {'Error' : 'The name given is not unique and already exists.'});
    }

    // Check if the response is json
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        res.status(406).json({'Error': 'The requested response content type is not supported.'});
    } else if(accepts === 'application/json'){
        const boat = await edit_boat(req.params.boat_id, req.body.name, req.body.type, req.body.length, req.auth.sub);
        
        if (boat == 404) {
            return res.status(404).json( {'Error' : 'No boat with this boat_id exists.'})
        }
        
        if (boat == 403) {
            return res.status(403).json( {'Error' : 'You are not authorized to edit this boat.'})
        }

        edited_boat = await get_boat(req.params.boat_id);

        // Update the location header and send status code 303
        res.setHeader('Location', req.protocol + '://' + req.get("host") + req.originalUrl);
        res.status(303).send({
            "id": req.params.boat_id,
            "name": boat.name, 
            "type": boat.type, 
            "length": boat.length,
            "owner": edited_boat[0].owner,
            "loads": edited_boat[0].loads,
            "self": req.protocol + "://" + req.get("host") + req.baseUrl + "/" + req.params.boat_id
        })
    } else { res.status(500).send('Content type got messed up!'); }

})

router.put('/', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        return res.status(401).send('JWT is invalid / missing.');
    } else {
        next('route');
    }
});

// Don't allow put on root of boats
router.put('/', async function(req, res) {
    res.set('Accept', 'GET, POST');
    res.status(405).json({ 'Error': 'Put on collection not allowed.'});
});

router.delete('/:boat_id', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        return res.status(401).send('JWT is invalid / missing.');
    } else {
        next('route');
    }
});

router.delete('/:boat_id', async function(req, res) {
    try {
        status_code = await delete_boat(req.params.boat_id, req.auth.sub);
        if (status_code == 404) {
            return res.status(404).json({ 'Error': 'No boat with this boat_id exists.'});
        } else if (status_code == 403){
            return res.status(403).json({ 'Error': 'You are not authorized to delete this boat.'});
        }
        else{
            return res.status(204).end();
        }

    } catch(error) {
        console.error(error);
    }
});

router.delete('/', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        return res.status(401).send('JWT is invalid / missing.');
    } else {
        next('route');
    }
});

// Don't allow delete on root of boats
router.delete('/', async function(req, res) {
    res.set('Accept', 'GET, POST');
    res.status(405).json({ 'Error': 'Delete on collection not allowed.'});
});

router.put('/:boat_id/loads/:load_id', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        return res.status(401).send('JWT is invalid / missing.');
    } else {
        next('route');
    }
});

router.put('/:boat_id/loads/:load_id', async function(req, res) {
    try {
        status_code = await assign_load(req.params.boat_id, req.params.load_id, req.auth.sub);
        if (status_code == 404) {
            res.status(404).json({ 'Error': 'The specified boat and/or load does not exist.'});
        } else if (status_code == 403) {
            res.status(403).json({ 'Error': 'The load is already loaded on another boat.'});
        } else if (status_code == 401) {
            res.status(403).json({ 'Error': 'You are not authorized to perform this action.'});
        } 
        else {
            res.status(204).end();
        }

    } catch(error) {
        console.error(error);
    }
});

router.delete('/:boat_id/loads/:load_id', checkJwt, async function(err, req, res, next) {
    if (err.name === "UnauthorizedError") {
        return res.status(401).send('JWT is invalid / missing.');
    } else {
        next('route');
    }
});

router.delete('/:boat_id/loads/:load_id', async function(req, res) {
    try {
        status_code = await remove_load(req.params.boat_id, req.params.load_id, req.auth.sub);
        if (status_code == 404) {
            res.status(404).json({ 'Error': 'No boat with this boat_id is loaded with the load with this load_id'});
        } else if (status_code == 403) {
            res.status(403).json({ 'Error': 'You are not authorized to perform this action.'});
        } else {
            res.status(204).end();
        }

    } catch(error) {
        console.error(error);
    }
});


/* ------------- End Boat Controller Functions ------------- */

module.exports = router;