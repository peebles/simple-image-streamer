# Image Streamer

Server to receive a stream of images from something like a webcam, and to serve those images
sequencially to clients as individual images, suitable for use in an `<img>` tag.

Uses Redis to maintain a sliding window of images per client that expire after a programmable
timeout.

## General Idea

An image producer first will make a GET call to get a unique session id.  Once it obtains a session id, it can
POST images to that session id, either as "multipart/form-data" style form posts, or with the raw image data in
the POST body.  These images are streamed into a queue maintained by Redis, with a programmable TTL.

Note that is is possible to POST with a session id that was not first obtained by making the GET call.  This
is dangerous if there are multiple image producers and consumers.

An image consumer armed with a session id can obtain images one at a time, in the order that they were sent by
the producer.  These images are streamed with a Content-type header, suitable for display in an `<img>` tag.
A simple consumer could be a web page with an `<img>` tag that gets periodicially reloaded.

## Quick Start and Test

```bash
docker-compose build
docker-compose up -d
```

Point your browser to the IP address of the container:

    http://IPADDR/image/xyzabc

and you should see images with a sequencial number; 1, 2, 3, ... etc.  If you wait for a minute or so and then reload
your browser, the sequence number will jump, as the previous images are expired from the Redis cache.

You can start scaling out the test producer if you like.  Edit the `docker-compose.yml` file and remove the TEST_SESSION
environment variable for the tester.  Then

```bash
docker-compose up -d
docker-compose scale tester=2
```

Then look at the tester log file to see what sessions it is sending images to:

```bash
docker-compose logs tester
```

and use those session ids in your browser.

## Configuration

Configuration of the server is done through environment variables.  See the `docker-compose.yml` for examples.

**REDIS_HOST**: The hostname or IP address to connect to redis.

**EXPIRE**: The TTL in seconds for stored images.

**MIMETYPE**: The mimetype for images used in this system.

When there is no data available on a session queue, a "No Data" image is generated and returned to the client.
The size of this image is programmable and should be programmed to match the size of expected normal images.
The size is programmed using an aspect ratio and a height, so width is calculated.  The aspect ratio should be
9 / 16 ( 0.5625 ) for a 16:9 image, or 3 / 4 ( 0.75 ) for a 4:3 image.

**NODATA_ASPECT_RATIO**: Aspect ration as a fraction.

**NODATA_HEIGHT**: The height of no data images in pixels.

## Endpoints

**GET /session**

Returns a session id that can then be used by image producers and consumers to reference a particular stream of
images.  If `Accept` header is set to "application.json", will return the session id as a json structure, otherwise
the session id is returned as plain text in the message body.

**POST /image/:sessionId**

The image data is expected as raw bytes in the request message body.

**POST /imageForm/:session**

The image data is expected as a file uploaded from a "multipart/form-data" style post.  Only one file is allowed
and the file field name is ignored.

**GET /image/:session**

Stream the next image available from the session.  The image data is streamed with a Content-type set to the **MIMETYPE**
you configured.

You can use this endpoint as the "src" attribute in an img tag.

**GET /stats**

Return some simple statistics.  Example output:

```javascript
{
   "numImages": 57,
   "numSessions": 1,
   "sessions": [
     {
       "id": "xyzabc",
       "len": 217
     }
   ]
}
```
