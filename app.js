var express = require( 'express' );
var winston = require( 'winston' );
var redis   = require( 'redis' );
var Busboy  = require( 'busboy' );
var shortid = require( 'shortid' );
var async   = require( 'async' );
var request = require( 'request' );
var cors    = require('cors')
  
// Expire time for images, in seconds
var EXPIRE = Number( process.env.EXPIRE || 120 );

var app = express();

// logging
app.log = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      level: 'debug',
      colorize: true,
      timestamp: true,
      prettyPrint: true,
      humanReadableUnhandledException: true,
    }),
  ]
});

// redis
var client = redis.createClient({
  port: 6379,
  host: process.env.REDIS_HOST || 'redis',
  return_buffers: true,
});

// report redis errors
client.on( 'error', function(err ) {
  app.log.error( 'redis:', err );
});

app.use(cors()); // enable cross origin access (CORS)

// Get a "session id", which ties an input stream to an output stream
app.get( '/session', function( req, res, cb ) {
  var id = shortid.generate();
  if ( req.headers && req.headers.accept && req.headers.accept.match( /^application\/json/ ) ) {
    res.json({ session: id });
  }
  else {
    res.status( 200 ).send( id );
  }
});

// Get images uploads via form-style uploads with file attachment
//
app.post( '/imageForm/:session', function( req, res, cb ) {
  var session = req.params.session;
  if ( ! session ) return cb( new Error( 'Missing a session id' ) );

  // Incoming images are stored as simple key/value entries with a TTL.  The key is session:<shortid>.  This
  // key is then stored in a queue by session.
  //
  // Reading involves popping the queue until a non-expired image is found and returning the image.
  //
  var id = shortid.generate(); // unique id for this image

  var busboy = new Busboy({ headers: req.headers });

  busboy.on( 'file', function( fieldName, file ) {
    file.on( 'data', function( data ) {
      //app.log.debug( 'receiving data for:', 'image:' + id );
      client.append( 'image:' + id, data, function( err ) {
	if ( err ) app.log.error( 'append:', err );
      });
    });
    file.on( 'end', function() {
      //app.log.debug( '=> image stored' );
      // set the ttl
      client.expire( 'image:' + id, EXPIRE, function( err ) {
	if ( err ) app.log.error( 'expire:', err );
	//else app.log.debug( '=> image expire set' );
	// push onto the queue
	client.rpush( 'session:' + session, 'image:' + id, function( err ) {
	  if ( err ) app.log.error( err );
	  //else app.log.debug( '=> image id pushed onto:', 'session:' + session, 'image:', id );
	  res.end();
	});
      });
    });
  });

  req.pipe( busboy );
});

// Get image uploads as raw bodies.
//
app.post( '/image/:session', function( req, res, cb ) {
  var session = req.params.session;
  if ( ! session ) return cb( new Error( 'Missing a session id' ) );
  var id = shortid.generate(); // unique id for this image
  req.on( 'data', function( data ) {
    //app.log.debug( 'receiving data for:', 'image:' + id );
    client.append( 'image:' + id, data, function( err ) {
      if ( err ) app.log.error( 'append:', err );
    });
  });
  req.on( 'end', function() {
    //app.log.debug( '=> image stored' );
    // set the ttl
    client.expire( 'image:' + id, EXPIRE, function( err ) {
      if ( err ) app.log.error( 'expire:', err );
      //else app.log.debug( '=> image expire set' );
      // push onto the queue
      client.rpush( 'session:' + session, 'image:' + id, function( err ) {
	if ( err ) app.log.error( err );
	//else app.log.debug( '=> image id pushed onto:', 'session:' + session, 'image:', id );
	res.end();
      });
    });
  });
});

// Clients call this to get images.  Called in a loop, will return sequencial images
// in the order in which they were queued.
//
app.get( '/image/:session', function( req, res, cb ) {
  var session = req.params.session;
  if ( ! session ) return cb( new Error( 'Missing a session id' ) );

  // The queue may reference images that have expired.  So keep popping from the queue until
  // an image is found, or there are no images to pop.

  client.llen( 'session:' + session, function( err, len ) {
    if ( err ) return cb( err );
    if ( ! len ) {
      // return a "no data" image
      return noData( req, res );
    }
    async.doUntil(
      function( cb ) {
	client.lpop( 'session:' + session, function( err, imageId ) {
	  if ( err ) return cb( err );
	  client.get( imageId.toString(), function( err, data ) {
	    if ( err ) return cb( err );
	    if ( data && data.length ) return cb( null, { id: imageId.toString(), data: data }, false );
	    // no image, see if there are any more entries in the queue
	    client.llen( 'session:' + session, function( err, len ) {
	      if ( err ) return cb( err );
	      cb( null, null, ( len ? false : true ) );
	    });
	  });
	});
      },
      function( image, empty ) {
	// If there is an image, we are done.
	// If we are empty, we are done
	// otherwise, keep going
	// app.log.debug( 'test:', ( image ? 'data' : 'no data' ), empty );
	if ( image ) return true;
	if ( empty ) return true;
	return false;
      },
      function( err, results ) {
	if ( err ) {
	  return cb( err );
	}
	var image = results;
	if ( ! image ) {
	  // return a "no data" image
	  return noData( req, res );
	}
	// remove it
	client.del( image.id, function( err ) {
	  if ( err ) return cb( err );
	  // send it
	  res.setHeader('Content-Type', ( process.env.MIMETYPE || 'image/jpeg' ) );
	  res.end( image.data );
	});
      });
  });
});

// Some stats
// The output will look like this:
//
// {
//    "numImages": 57,
//    "numSessions": 1,
//    "sessions": [
//      {
//        "id": "xyzabc",
//        "len": 217
//      }
//    ]
// }
//
app.get( '/stats', function( req, res, cb ) {
  sessionData = {};
  client.keys( 'session:*', function( err, sessions ) {
    if ( err ) return cb( err );
    sessionData.numSessions = sessions.length;
    sessionData.sessions = [];
    async.each( sessions, function( sessionId, cb ) {
      sessionId = sessionId.toString();
      client.llen( sessionId, function( err, len ) {
	if ( err ) return cb( err );
	var info = sessionId.split( ':' );
	sessionData.sessions.push({ id: info[1], len: len });
	cb();
      });
    }, function( err ) {
      if ( err ) return cb( err );
      client.keys( 'image:*', function( err, images ) {
	if ( err ) return cb( err );
	sessionData.numImages = images.length;
	res.json( sessionData );
      });
    });
  });
});
  
var server = app.listen( process.env.PORT || 3000, function() {
  app.log.info( 'server listening on:', process.env.PORT || 3000 );
});

function noData( req, res ) {
  var ratio = process.env.NODATA_ASPECT_RATIO || ( 9/16 ); // 16:9 by default.
  var height = process.env.NODATA_HEIGHT || 720;
  var width = Math.round( Number(height) * ( 1/Number(ratio) ) );
  var url = "https://placehold.it/" + width + "x" + height + "?text=No%20Data";
  var x = request( url );
  req.pipe( x );
  x.pipe( res );
}
