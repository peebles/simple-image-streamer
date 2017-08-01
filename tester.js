//
// For testing the image streamer.  This just uses a web service to generate
// sequencial images and upload them to the streamer at some fixed frequency.
//
var request = require( 'request' );
var async = require( 'async' );
var shortid = require( 'shortid' );

var session = process.env.TEST_SESSION || shortid.generate();
console.log( 'SESSION:', session );

function getAndSend( num ) {
  var ratio = process.env.NODATA_ASPECT_RATIO || ( 9/16 ); // 16:9 by default.
  var height = process.env.NODATA_HEIGHT || 720;
  var width = Math.round( Number(height) * ( 1/Number(ratio) ) );
  var url = "https://placehold.it/" + width + "x" + height + ".jpg?text=" + num.toString();
  request.get( url ).pipe( request.post( 'http://app:3000/image/' + session ) );
}

var seqnum = 1;

setInterval( function() {
  getAndSend( seqnum );
  seqnum += 1;
}, 2000 );

