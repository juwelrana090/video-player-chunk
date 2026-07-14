const express = require("express");
const fs = require("fs");
const app = express();

app.get("/", function (req, res) {
    res.sendFile(__dirname + "/index.html");
});

app.get("/video", function (req, res) {
    const range = req.headers.range;
    if (!range) {
        res.status(400).send("Requires Range header")
    }
    const videoPath = new url("test.mp4");
    const videoSize = fs.statSync(videoPath).size;

    // Pares Range 
    // Example : "bytes=32324-"
    const CHUNK_SIZE = 10 ** 6; //1MB
    const start = Number(range.replace(/\D/g, ""));
    const end = Math.min(start + CHUNK_SIZE, videoSize - 1);

    const contentength = end - start + 1;
    const headers = {
        "Content-Range": `bytes ${start}-${end}/${videoSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": contentength,
        "Coontent_Type": "video/mp4",
    };

    res.writeHead(206, headers);
    const VideoStream = fs.createReadStream(videoPath, { start, end });
    VideoStream.pipe(res);


});

app.listen(8000, function () {
    console.log("Listening on port 8000!")
});