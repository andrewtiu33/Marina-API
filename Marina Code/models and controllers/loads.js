const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const ds = require('./datastore');

const datastore = ds.datastore;

const BOAT = "Boat";
const LOAD = "Load";

router.use(bodyParser.json());

/* ------------- Begin Load Model Functions ------------- */
// Model handles saving and loading properties to the database
// This function creates a new load
async function post_load(item, volume, creation_date) {
    const key = datastore.key(LOAD); 
    const new_load = { "item": item, "volume": volume, "creation_date": creation_date, "carrier": null} ;
    try {
        await datastore.save({"key": key, "data": new_load}) ;
        return key;

    } catch (error) {
        console.error(error);
    }
}

// This function returns the list of loads in the database
async function get_loads(req) {
    var q = datastore.createQuery(LOAD).limit(5);
    let results = {}; 
    if(Object.keys(req.query).includes("cursor")){
        q = q.start(req.query.cursor);
    }

    try {
        let loads = await datastore.runQuery(q);
        let q2 = datastore.createQuery(LOAD);
        let total = await datastore.runQuery(q2);
        results.total = total[0].length;
        

        results.loads = loads[0].map(ds.fromDatastore);
        if (loads[1].moreResults !== ds.Datastore.NO_MORE_RESULTS) {
            results.next = req.protocol + "://" + req.get("host") + req.baseUrl + "?cursor=" + loads[1].endCursor;
        }
        return results;
    } catch (error) {
        console.error(error);
    }
}

// This function gets the data of a single load from the database
async function get_load(id) {
    const key = datastore.key([LOAD, parseInt(id, 10)]);
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

// This function edits the data of a single load from the database
async function edit_load(id, item, volume, creation_date) {
    const key = datastore.key([LOAD, parseInt(id, 10)]);
    const load_to_edit = await datastore.get(key);
    const edited_load = {};

    // Case where the load does not exist
    if (load_to_edit[0] === undefined || load_to_edit[0] === null) {
        return 404;
    }

    edited_load.carrier = load_to_edit[0].carrier;

    // Set the name, type, length attributes if they were given and if not set to default
    if (item) {
        edited_load.item = item;
    } else {
        edited_load.item = load_to_edit[0].item;
    }

    if (volume) {
        edited_load.volume = volume;
    } else {
        edited_load.volume = load_to_edit[0].volume;
    }

    if (creation_date) {
        edited_load.creation_date = creation_date;
    } else {
        edited_load.creation_date = load_to_edit[0].creation_date;
    }

    try {
        await datastore.save({ "key" : key, "data" : edited_load});
        return edited_load;

    } catch(error) {
        console.error(error);
    }
}


// This function deletes a load. If the load currently has a carrier, the boat is updated to no longer have that load.
async function delete_load(load_id) {
    const load_key = datastore.key([LOAD, parseInt(load_id, 10)]);

    try {
        const load = await datastore.get(load_key);

        // Case where the load does not exist
        if (load[0] === undefined || load[0] === null) {
            return 404;
        } 
        // If there is a carrier boat, update the carrier boat to no longer have this load
            
        if (load[0].carrier) {
            boat_id = load[0].carrier.id;
            const boat_key = datastore.key([BOAT, parseInt(boat_id, 10)]);
            const boat = await datastore.get(boat_key);
            const load_index = boat[0].loads.findIndex(function(item, i) {
                return item.id == load_id; 
            })
            boat[0].loads.splice(load_index, 1);
            await datastore.save({"key": boat_key, "data": boat[0]});
        }
        
        await datastore.delete(load_key);
        return 204;
        
    }
    catch (error) {
        console.error(error);
    }
}


/* ------------- End Load Model Functions ------------- */

/* ------------- Begin Load Controller Functions ------------- */
router.post('/', async function(req, res) {
    // Check if request is json
    if (req.get('content-type') !== 'application/json') {
        return res.status(415).json({'Error': 'Server only accepts application/json data.'})
    }

    // Check if any of the 3 required attributes are missing and if one is missing return status code 400
    if (req.body.volume == null || req.body.item == null || req.body.creation_date == null) {
        return res.status(400).json( {'Error' : 'The request object is missing at least one of the required attributes'});
    }

    // Check if the accept header is json
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        return res.status(406).json({'Error': 'The requested response content type is not supported.'});
    }

    let key = await post_load(req.body.item, req.body.volume, req.body.creation_date);
            
    // If all attributes are there, return status code 201 and ID
    res.status(201).send({
        "id": key.id, 
        "item": req.body.item,
        "volume": req.body.volume, 
        "creation_date": req.body.creation_date,
        "carrier": null, 
        "self": req.protocol + "://" + req.get("host") + req.baseUrl + "/" + key.id
    });

});

router.get('/', async function (req, res) {
    try{
        let results = await get_loads(req);
        let loads = results.loads;

        // Add the self link to the loads
        for(let i = 0; i < loads.length; i++) {
            let current_load = loads[i];
            current_load.self = req.protocol + "://" + req.get("host") + "/loads/" + current_load.id;

            // Add the self link to the carrier
            if (current_load.carrier) {
                current_load.carrier.self = req.protocol + "://" + req.get("host") + "/boats/" + current_load.carrier.id;
            }
        }
        res.status(200).json(results);
    } catch(error) {
        console.error(error);
    }
});

router.get('/:load_id', async function(req, res) {
    // Check if the accept header is json
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        return res.status(406).json({'Error': 'The requested response content type is not supported.'});
    }

    const load = await get_load(req.params.load_id);

    if (load[0] === undefined || load[0] === null) {
        // If the 0th element is undefined, there is no load with this id
        return res.status(404).json({ 'Error': 'No load with this load_id exists.'});
    }
    
    load[0].self = req.protocol + "://" + req.get("host") + req.baseUrl + "/" + req.params.load_id;
    if (load[0].carrier) {
        load[0].carrier.self = req.protocol + "://" + req.get("host") + "/boats/" + load[0].carrier.id;
    }

    // Return the 0th element which is the load with this id
    return res.status(200).json(load[0]);
        
});


router.patch('/:load_id', async function(req, res) {
    // Check if request's MIME type is not suppoted
    if (req.get('content-type') !== 'application/json') {
        return res.status(415).json({'Error': 'Server only accepts application/json data.'})
    }

    // Check if all of the 3 attributes are missing 
    if (req.body.item === undefined && req.body.volume === undefined && req.body.creation_date === undefined) {
            return res.status(400).json( {'Error' : 'The request object is missing required attributes.'});
    }
    
    // Check if the response is json
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        res.status(406).json({'Error': 'The requested response content type is not supported.'});
    } else if(accepts === 'application/json'){
        
        const load = await edit_load(req.params.load_id, req.body.item, req.body.volume, req.body.creation_date);

        if (load == 404) {
            return res.status(404).json( {'Error' : 'No load with this load_id exists.'})
        }

        if (load == 403) {
            return res.status(403).json( {'Error' : 'You are not authorized to edit this load.'})
        }

        edited_load = await get_load(req.params.load_id);
        edited_load[0].self = req.protocol + "://" + req.get("host") + req.baseUrl + "/" + req.params.load_id;
        return res.status(200).json(edited_load[0]);

    } else { res.status(500).send('Content type got messed up!'); }

});

router.put('/:load_id', async function(req, res) {
    // Check if request's MIME type is not suppoted
    if (req.get('content-type') !== 'application/json') {
        return res.status(415).json({'Error': 'Server only accepts application/json data.'})
    }

    // Check if any of the 3 required attributes are missing 
    if (req.body.item === null || req.body.item === undefined || req.body.volume === null || req.body.volume === undefined ||
        req.body.creation_date === null || req.body.creation_date === undefined) {
            return res.status(400).json( {'Error' : 'The request object is missing required attributes.'});
    }
    
    // Check if the response is json
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        res.status(406).json({'Error': 'The requested response content type is not supported.'});
    } else if(accepts === 'application/json'){
        const load = await edit_load(req.params.load_id, req.body.item, req.body.volume, req.body.creation_date);
        
        if (load == 404) {
            return res.status(404).json( {'Error' : 'No load with this load_id exists.'})
        }
        
        edited_load = await get_load(req.params.load_id);

        // Update the location header and send status code 303
        res.setHeader('Location', req.protocol + '://' + req.get("host") + req.originalUrl);
        if (edited_load[0].carrier) {
            edited_load[0].carrier.self = req.protocol + "://" + req.get("host") + "/boats/" + load[0].carrier.id;
        }
        res.status(303).send({
            "id": req.params.load_id,
            "item": load.item, 
            "volume": load.volume, 
            "creation_date": load.creation_date,
            "carrier": edited_load[0].carrier,
            "self": req.protocol + "://" + req.get("host") + req.baseUrl + "/" + req.params.load_id
        })
    } else { res.status(500).send('Content type got messed up!'); }

})

router.delete('/:load_id', async function(req, res) {
    try {
        status_code = await delete_load(req.params.load_id);
        if (status_code == 404) {
            res.status(404).json({ 'Error': 'No load with this load_id exists.'});
        } else {
            res.status(204).end();
        }

    } catch(error) {
        console.error(error);
    }
});



/* ------------- End Load Controller Functions ------------- */

module.exports = router;