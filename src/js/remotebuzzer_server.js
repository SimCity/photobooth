/* VARIABLES */
let collageInProgress = false,
    triggerArmed = true;
const API_DIR_NAME = 'api';
const API_FILE_NAME = 'config.php';
const PID = process.pid;
let prevRotaryClkState;
let leds, printLed, pictureLed, collageLed, shutdownLed;

/* LOGGING FUNCTION */
const log = function (...optionalParams) {
    console.log('[', new Date().toISOString(), ']:', ` Remote Buzzer Server [${PID}]:`, ...optionalParams);
};

/* HANDLE EXCEPTIONS */
process.on('uncaughtException', function (err) {
    log('Error: ', err.message);
    fs.unlink(pidFilename, function (error) {
        if (error) {
            log('Error deleting PID file ', error.message);
        }
    });
    log('Exiting');

    /* got to exit now and here - can not recover from error */
    process.exit();
});

/* SOURCE PHOTOBOOTH CONFIG */
const {execSync} = require('child_process');
let cmd = `cd ${API_DIR_NAME} && php ./${API_FILE_NAME}`;
let stdout = execSync(cmd).toString();
const config = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf(';')));

/* WRITE PROCESS PID FILE */
const pidFilename = config.foldersRoot.tmp + '/remotebuzzer_server.pid';
const fs = require('fs');

fs.writeFile(pidFilename, PID, function (err) {
    if (err) {
        throw new Error('Unable to write PID file [' + pidFilename + '] - ' + err.message);
    }

    log('PID file created [', pidFilename, ']');
});

/* START HTTP & WEBSOCKET SERVER */
const baseUrl = 'http://' + config.webserver.ip + ':' + config.remotebuzzer.port;
log('Server starting on ' + baseUrl);

function photoboothAction(type) {
    switch (type) {
        case 'picture':
            triggerArmed = false;
            collageInProgress = false;
            log('Photobooth trigger PICTURE : [ photobooth-socket ] => [ All Clients ]: command [ picture ]');
            ioServer.emit('photobooth-socket', 'start-picture');
            break;

        case 'collage':
            triggerArmed = false;
            collageInProgress = true;
            log('Photobooth trigger COLLAGE : [ photobooth-socket ]  => [ All Clients ]: command [ collage ]');
            ioServer.emit('photobooth-socket', 'start-collage');
            break;

        case 'collage-next':
            log('Photobooth COLLAGE : [ photobooth-socket ]  => [ All Clients ]: command [ collage-next ]');
            ioServer.emit('photobooth-socket', 'collage-next');
            break;

        case 'completed':
            triggerArmed = true;
            collageInProgress = false;
            log('Photobooth activity completed : [ photobooth-socket ] => [ All Clients ]: command [ completed ]');
            ioServer.emit('photobooth-socket', 'completed');
            photoboothAction('picture-pulse');
            if(config.remotebuzzer.collagebutton && config.collage.enabled)
            {
                photoboothAction('collage-pulse');
            }
            break;

        case 'print':
            triggerArmed = false;
            log('Photobooth trigger PRINT : [ photobooth-socket ]  => [ All Clients ]: command [ print ]');
            ioServer.emit('photobooth-socket', 'print');
            break;

        case 'rotary-cw':
            ioServer.emit('photobooth-socket', 'rotary-cw');
            break;

        case 'rotary-ccw':
            ioServer.emit('photobooth-socket', 'rotary-ccw');
            break;

        case 'rotary-btn-press':
            ioServer.emit('photobooth-socket', 'rotary-btn-press');
            break;

        case 'reset':
            photoboothAction('all-off');
            photoboothAction('completed');
            break;

        case 'print-blink':
            var printBlinkCount = 0;
            printLed.blink(100, function() { 
                if(printBlinkCount = 5)
                {
                    printLed.stop().off();
                } 
                printBlinkCount++;
            });
            break;

        case 'print-pulse':
            printLed.pulse(500);
            break;

        case 'print-off':
            printLed.stop().off();
            break;

        case 'picture-pulse':
            pictureLed.pulse(500);
            break;

        case 'picture-off':
            pictureLed.stop().off();
            break;

        case 'picture-blink':
            pictureLed.blink(100, function() { pictureLed.stop().off(); });
            break;

        case 'collage-pulse':
            collageLed.pulse(500);
            break;

        case 'collage-off':
            collageLed.stop().off();
            break;

        case 'collage-blink':
            collageeLed.blink(100, function() { collageLed.stop().off(); });
            break;

        case 'all-off':
            leds.stop().off();
            break;

        default:
            log('Photobooth action [', type, '] not implemented - ignoring');
            break;
    }
}

/* CONFIGURE HTTP ENDPOINTS */
const requestListener = function (req, res) {
    function sendText(content, contentType) {
        res.setHeader('Content-Type', contentType || 'text/plain');
        res.writeHead(200);
        res.end(content);
    }

    switch (req.url) {
        case '/':
            log('http: GET /');
            sendText(
                `<h1>Trigger Endpoints</h1>
            <ul>
                <li>Trigger photo: <a href="${baseUrl}/commands/start-picture" target="_blank">${baseUrl}/commands/start-picture</a></li>
                <li>Trigger collage: <a href="${baseUrl}/commands/start-collage" target="_blank">${baseUrl}/commands/start-collage</a></li>
            </ul>`,
                'text/html'
            );
            break;
        case '/commands/start-picture':
            log('http: GET /commands/start-picture');
            if (triggerArmed) {
                photoboothAction('picture');
                sendText('TAKE PHOTO TRIGGERED');
            } else {
                sendText('TAKE PHOTO ALREADY TRIGGERED');
            }

            break;
        case '/commands/start-collage':
            log('http: GET /commands/start-collage');
            if (triggerArmed) {
                photoboothAction('collage');
                sendText('TAKE COLLAGE TRIGGERED');
            } else {
                sendText('TAKE COLLAGE ALREADY TRIGGERED');
            }

            break;
        default:
            res.writeHead(404);
            res.end();
    }
};

const http = require('http');
const server = new http.Server(requestListener);

/* CONFIGURE WEBSOCKET SERVER */
const ioServer = require('socket.io')(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

/* NEW CLIENT CONNECTED */
ioServer.on('connection', function (client) {
    log('New client connected - ID', client.id);

    client.on('photobooth-socket', function (data) {
        log('Data from client ID ', client.id, ': [ photobooth-socket ] =>  [' + data + ']');

        /* CLIENT COMMANDS RECEIVED */
        switch (data) {
            case 'completed':
                photoboothAction('completed');
                break;

            case 'in-progress':
                triggerArmed = false;
                break;

            case 'start-picture':
                photoboothAction('picture');
                break;

            case 'start-collage':
                photoboothAction('collage');
                break;

            case 'printing-in-progress':
                photoboothAction('all-off');
                break;

            case 'printing-completed':
                photoboothAction('print-blink');
                break;

            case 'printing-avaiable':
                photoboothAction('print-pulse');
                break;

            case 'printing-unavaiable':
                photoboothAction('print-off');
                break;

            case 'picture-in-progress':
                photoboothAction('picture-off');
                break;

            case 'picture-completed':
                photoboothAction('picture-off');
                break;

            case 'countdown-pulse':
                if (collageInProgress)
                {
                    photoboothAction('collage-blink');
                }
                else
                {
                    photoboothAction('picture-blink');
                }
                break;

            case 'collage-wait-for-next':
                photoboothAction('collage-pulse');
                triggerArmed = true;
                break;

            default:
                log('Received unknown command [', data, '] - ignoring');
                break;
        }
    });

    /* CLIENT DISCONNECTED */
    client.on('disconnect', function () {
        log('Client disconnected - ID ', client.id);

        if (ioServer.engine.clientsCount == 0) {
            log('No more clients connected - removing lock and arming trigger');
            triggerArmed = true;
            collageInProgress = false;
        }
    });
});

/* STARTUP COMPLETED */
server.listen(config.remotebuzzer.port, () => {
    log('socket.io server started');
});

/*
 ** GPIO HANDLING
 */

/* SANITY CHECKS */
function gpioSanity(gpioconfig) {
    if (isNaN(gpioconfig)) {
        throw new Error(gpioconfig + ' is not a valid number');
    }

    if (gpioconfig < 1 || gpioconfig > 27) {
        throw new Error('GPIO' + gpioconfig + ' number is out of range (1-27)');
    }

    cmd = 'sed -n "s/^gpio=\\(.*\\)=pu/\\1/p" /boot/config.txt';
    stdout = execSync(cmd).toString();

    if (!stdout.split(',').find((el) => el == gpioconfig)) {
        throw new Error('GPIO' + gpioconfig + ' is not configured as PULLUP in /boot/config.txt - see FAQ for details');
    }
}

if (config.remotebuzzer.usegpio) {
    gpioSanity(config.remotebuzzer.picturegpio);
    gpioSanity(config.remotebuzzer.collagegpio);
    gpioSanity(config.remotebuzzer.shutdowngpio);
    gpioSanity(config.remotebuzzer.printgpio);
    gpioSanity(config.remotebuzzer.pictureledgpio);
    gpioSanity(config.remotebuzzer.collageledgpio);
    gpioSanity(config.remotebuzzer.shutdownledgpio);
    gpioSanity(config.remotebuzzer.printledgpio);
    gpioSanity(config.remotebuzzer.rotaryclkgpio);
    gpioSanity(config.remotebuzzer.rotarydtgpio);
    gpioSanity(config.remotebuzzer.rotarybtngpio);
}

/* TIMER HELPER FUNCTION */
function buttonTimer(millis) {
    /* init */
    if (typeof buttonTimer.millis == 'undefined' || millis === 0) {
        buttonTimer.millis = 0;
        buttonTimer.duration = 0;
    }

    /* return timer value */
    if (typeof millis == 'undefined') {
        return buttonTimer.duration;
    }

    /* start timer */
    if (buttonTimer.millis === 0) {
        buttonTimer.millis = millis;

        return true;
    }

    /* end timer */
    if (millis - buttonTimer.millis > 0) {
        buttonTimer.duration = millis - buttonTimer.millis;
        buttonTimer.millis = 0;

        return buttonTimer.duration;
    }

    /* error state */
    log('buttonTimer error state encountered - millis: ', millis);

    return false;
}


const buttonPressed = function buttonPressed(button)
{
    //check if another button is already pressed so we can avoid multiple actions at once
    if (buttonHeld != -1)
    {
        log(
            'buttonActiveCheck WARNING - requested GPIO ',
            button.pin,
            ', for value ',
            button.value,
            'but buttonIsPressed:',
            buttonHeld,
            ' Please consider to add an external pull-up resistor to all your input GPIOs, this might help to eliminate this warning. Regardless of this warning, Photobooth should be fully functional.'
        );
        return;
    }

    //check if there is already another process happening

    //this stops GPIO buttons interfering with tasks triggered by other means (e.g., theres a photo already being taken, or printing is happening)
    if (!triggerArmed)
    {
        return;
    }


    //record the button pressed
    buttonHeld = button.id;
    
    //if picture button is dong double duty as hold for collage, need to keep track of time held separately ad HeldTimer is used for too long hold
    //also keep track for shutdown to ensure mispress is not actioned
    if (buttonHeld == "pictureWithCollage" || buttonHeld == "shutdown" )
    {
        buttonTimer(Date.now('millis'));
    }
    
    log('GPIO ', button.pin, ' - ', button.id, ' button pressed');
};

//if this triggers a button was held down too long, flag everythign to reset upon release.
const buttonHeldTooLong = function buttonHeldTooLong(button) 
{
    buttonHeldDown = true;
};

//when a button is released, handle the event
const buttonReleased = function buttonReleased(button)
{
    //check if if was the original button pressed, do nothing if it wasnt.
    if (buttonHeld != button.id)
    {
        return;
    }

    //check if a hold event occurred to invalidate input
    if(buttonHeldDown)
    {
        //Too long button press - timeout - reset server state machine 
        buttonHeldDown = false;
        buttonTimer(0);
        log('GPIO', button.pin, '- too long button press - Reset server state machine');
        photoboothAction('reset');
    }

    //process what to do
    /* Button released - raising flank detected */
    const timeElapsed = buttonTimer();

    switch (button.id)
    {
        case "picture":
            pictureReleased(timeElapsed);
            break;
        case "pictureWithCollage":
            pictureWithCollageReleased(timeElapsed);
            break;
        case "collage":
            collageReleased(timeElapsed);
            break; 
        case "print":
            printReleased(timeElapsed);
            break;
        case "shutdown":
            shutdownReleased(timeElapsed);
            break;
    }

    //clear held button to none, ready for processing another button press
    buttonHeld = -1
};

/* WATCH FUNCTION PICTURE BUTTON WITH LONGPRESS FOR COLLAGE*/
const pictureWithCollageReleased = function pictureWithCollageReleased(timeElapsed) {

    if (timeElapsed <= config.remotebuzzer.collagetime * 1000 && !collageInProgress) {
        /* Start Picture */
        log('GPIO', config.remotebuzzer.picturegpio, '- Picture button released - normal -', timeElapsed, ' [ms] ');
        photoboothAction('picture');
    } else if (collageInProgress) {
        /* Next Collage Picture*/
        log('GPIO', config.remotebuzzer.picturegpio, '- Picture button released - long -', timeElapsed, ' [ms] ');
        photoboothAction('collage-next');
    } else {
        /* Start Collage */
        log('GPIO', config.remotebuzzer.picturegpio, '- Picture button released - long -', timeElapsed, ' [ms] ');
        photoboothAction('collage');
    }

};

/* WATCH FUNCTION PICTURE BUTTON */
const pictureReleased = function pictureReleased(timeElapsed) 
{

    log('GPIO', config.remotebuzzer.picturegpio, '- Picture button released - normal -', timeElapsed, ' [ms] ');
    /* Start Picture */
    if (!collageInProgress) {
        photoboothAction('picture');
    }

};

/* WATCH FUNCTION COLLAGE BUTTON */
const collageReleased = function collageReleased(timeElapsed) 
{

    log('GPIO', config.remotebuzzer.collagegpio, '- Collage button released ', timeElapsed, ' [ms] ');

    /* Collage Trigger Next */
    if (collageInProgress) {
        photoboothAction('collage-next');
    } else {
        /* Start Collage */
        photoboothAction('collage');
    }
};

/* WATCH FUNCTION SHUTDOWN BUTTON */
const shutdownReleased = function shutdownReleased(timeElapsed) 
{
    log('GPIO', config.remotebuzzer.shutdowngpio, '- Shutdown button released ', timeElapsed, ' [ms] ');

    if (timeElapsed >= config.remotebuzzer.shutdownholdtime * 1000) {
        log('System shutdown initiated - bye bye');
        /*  Initiate system shutdown */
        cmd = 'sudo ' + config.shutdown.cmd;
        stdout = execSync(cmd);
    }
};

/* WATCH FUNCTION PRINT BUTTON */
const printReleased = function printReleased(timeElapsed) {

    log('GPIO', config.remotebuzzer.printgpio, '- Print button released ', timeElapsed, ' [ms] ');

    /* Start Print */
    photoboothAction('print');

};

/* WATCH FUNCTION ROTARY MOVEMENT */
const rotaryMove = function rotaryMove(rotaryChange) {
    //keep track of Dt state
    if(rotartChange.id == 'dt')
    {
        rotaryDT = rotartChange.value;
    }

    /* if there is some activity in progress ignore movement for now */
    if (triggerArmed) {
        //if previous clock was 0 then clockwise is DT = 1
        if(prevRotaryClkState)
        {
            if(rotary[1].value) 
            {
                photoboothAction('rotary-cw');
            }
            else
            {
                photoboothAction('rotary-ccw');
            }
        }
        else
            {
            //otherwise its the opoiste
            if(rotary[1].value) 
            {
                photoboothAction('rotary-ccw');
            }
            else
            {
                photoboothAction('rotary-cw');
            }
        }
    }   

    //record clock state for next time as it may have changed
   if(rotary.id = 'clk')
   {
       prevRotaryClkState = rotary.value;
   };
};

/* WATCH FUNCTION ROTARY BUTTON */
const rotaryBtnRelease = function rotaryBtnRelease() {

    /* if there is some activity in progress ignore GPIO pin for now */
    if (!triggerArmed) {
        return;
    }

    photoboothAction('rotary-btn-press');
    
};


var five = require("johnny-five");
var Raspi = require("raspi-io").RaspiIO;
if (config.remotebuzzer.usegpio) {
    var board = new five.Board({
        io: new Raspi()
        });
    board.on("ready", function() {
        
        /* ROTARY ENCODER MODE */
        if (config.remotebuzzer.userotary) {
            /* ROTARY ENCODER MODE */
            log('ROTARY support active');
            var rotary = new five.Buttons([
                {
                    id: "clk",
                    pin: "P1-${config.remotebuzzer.rotaryclkgpio}", 
                    isPullup: true, 
                },
                {
                    id: "dt",
                    pin: "P1-${config.remotebuzzer.rotarydtgpio}",
                    isPullup: true, 
                }
            ]);

            var rotaryBtn = new five.Button({
                pin: "P1-${config.remotebuzzer.rotarybtngpio}",
                isPullup: true,
                debounce: config.remotebuzzer.debounce
            });

            prevRotaryClkState = rotary[0].value;

            rotary.on("press", rotaryMove);
            rotary.on("release", rotaryMove);

            rotaryBtn.on("release", rotaryBtnRelease);

            log(
                'Looking for Rotary Encoder connected to GPIOs ',
                config.remotebuzzer.rotaryclkgpio,
                '(CLK) ',
                config.remotebuzzer.rotarydtgpio,
                '(DT) ',
                config.remotebuzzer.rotarybtngpio,
                '(BTN)'
            );
        }

        /* NORMAL BUTTON SUPPORT */
        if (config.remotebuzzer.usebuttons) {
            var usedButtons = [];
            var usedLEDs = [];

            log('BUTTON support active');
            if (config.remotebuzzer.picturebutton) {
                var pictureButton = new five.Button({
                    id: "picture" + (!config.remotebuzzer.collagebutton && config.collage.enabled) ? "WithCollage" : "",
                    pin: "P1-${config.remotebuzzer.picturegpio}",
                    isPullup: true, 
                    debounce: config.remotebuzzer.debounce,
                    holdTime: 10000
                });
                usedButtons.push(pictureButton);
                log('Looking for Picture Button on Raspberry GPIO', config.remotebuzzer.picturegpio);

                if(config.remotebuzzer.pictureLED) {
                    pictureLed = new five.Led("P1-${config.remotebuzzer.pictureledgpio}");
                    usedLEDs.push(pictureLed);
                    if(!config.remotebuzzer.collagebutton && config.collage.enabled)
                    {
                        collageLed =  pictureLed;
                    }
                }
            }

            /* COLLAGE BUTTON */
            if (config.remotebuzzer.collagebutton && config.collage.enabled) {
                var collageButton = new five.Button({
                    id: "collage",
                    pin: "P1-${config.remotebuzzer.collagegpio}", 
                    isPullup: true, 
                    debounce: config.remotebuzzer.debounce,
                    holdTime: 10000
                });
                usedButtons.push(collageButton);
                log('Looking for Collage Button on Raspberry GPIO', config.remotebuzzer.collagegpio);

                if(config.remotebuzzer.collageLED) {
                    collageLed = new five.Led("P1-${config.remotebuzzer.collageledgpio}");
                    usedLEDs.push(collageLed);
                }
            }

            /* SHUTDOWN BUTTON */
            if (config.remotebuzzer.shutdownbutton) {
                var shutdownButton = new five.Button({
                    id: "shutdown",
                    pin: "P1-${config.remotebuzzer.shutdowngpio}",
                    isPullup: true, 
                    debounce: config.remotebuzzer.debounce,
                    holdTime: 10000
                });
                usedButtons.push(shutdownButton);
                log('Looking for Shutdown Button on Raspberry GPIO', config.remotebuzzer.shutdowngpio);
                
                if(config.remotebuzzer.shutdownLED) {
                    shutdownLed = new five.Led("P1-${config.remotebuzzer.shutdownledgpio}");
                    usedLEDs.push(shutdownLed);
                }
            }

            /* PRINT BUTTON */
            if (config.remotebuzzer.printbutton) {
                var printButton = new five.Button({
                    id: "print",
                    pin: "P1-${config.remotebuzzer.printgpio}",
                    isPullup: true, 
                    debounce: config.remotebuzzer.debounce,
                    holdTime: 10000
                });
                usedButtons.push(printButton);
                log('Looking for Print Button on Raspberry GPIO', config.remotebuzzer.printgpio);
                
                if(config.remotebuzzer.printLED) {
                    printLed = new five.Led("P1-${config.remotebuzzer.printledgpio}");
                    usedLEDs.push(printLed);
                }
            }
                
            //create a button collection from the buttons setup to handle events
            gpioButtons = new five.Buttons(usedButtons);
            gpioButtons.on("press", buttonPressed);
            gpioButtons.on("release", buttonReleased);
            gpioButtons.on("hold", buttonHeldTooLong);

            leds = new five.Leds(usedLEDs);

            leds.stop().off();
        }
    }); 
}

log('Initialization completed');
