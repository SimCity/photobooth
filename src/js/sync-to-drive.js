#!/usr/bin/env node
/* eslint-disable node/shebang */

const {execSync, spawn} = require('child_process');
const fs = require('fs');
const path = require('path');
const {pid: PID, platform: PLATFORM} = process;

//This script needs to be run from within the photobooth directory
const API_DIR_NAME = 'api';
const API_FILE_NAME = 'config.php';

const getConfigFromPHP = () => {
    const cmd = 'cd ' + API_DIR_NAME + ' && php ./' + API_FILE_NAME;

    try {
        const stdout = execSync(cmd).toString();

        return JSON.parse(stdout.slice(stdout.indexOf('{'), -1));
    } catch (err) {
        console.log('Sync-To-Drive server [', PID, ']: ERROR: Couldnt get config from PHP', err);
    }

    return null;
};

const parseConfig = (config) => {
    if (!config) {
        return null;
    }

    try {
        return {
            dataAbsPath: config.foldersAbs.data,
            drives: [config.synctodrive_targets.split(';')]
        };
    } catch (err) {
        console.log('Sync-To-Drive server [', PID, ']: ERROR: Couldt parse config', err);
    }

    return null;
};

const getDriveInfos = ({drives}) => {
    let json = null;

    try {
        //Assuming that the lsblk version supports JSON output!
        const output = execSync('export LC_ALL=C; lsblk -ablJO 2>/dev/null; unset LC_ALL').toString();
        json = JSON.parse(output);
    } catch (err) {
        console.log(
            'Sync-To-Drive server [',
            PID,
            ']: ERROR: Could not parse the output of lsblk! Please make sure its installed and that it offers JSON output!'
        );

        return null;
    }

    if (!json || !json.blockdevices) {
        console.log('Sync-To-Drive server [', PID, ']: ERROR: The output of lsblk was malformed!');

        return null;
    }

    return json.blockdevices.reduce((arr, blk) => {
        if (
            drives.some(
                (drive) => drive === blk.name || drive === blk.kname || drive === blk.path || drive === blk.label
            )
        ) {
            arr.push(blk);
        }

        return arr;
    }, []);
};

const mountDrives = (drives) => {
    const result = [];

    for (const drive of drives) {
        if (!drive.mountpoint) {
            try {
                const mountRes = execSync(
                    'export LC_ALL=C; udisksctl mount -b ' + drive.path + '; unset LC_ALL'
                ).toString();
                const mountPoint = mountRes
                    .substr(mountRes.indexOf('at') + 3)
                    .trim()
                    .replace(/[\n.]/gu, '');

                drive.mountpoint = mountPoint;
            } catch (error) {
                console.log('Sync-To-Drive server [', PID, ']: ERROR: Count mount ' + drive.path);
            }
        }

        if (drive.mountpoint) {
            result.push(drive);
        }
    }

    return result;
};

const startSync = ({dataAbsPath, drives}) => {
    if (!fs.existsSync(dataAbsPath)) {
        console.log('Sync-To-Drive server [', PID, ']: ERROR: Folder ' + dataAbsPath + ' does not exist!');

        return;
    }

    console.log('Sync-To-Drive server [', PID, ']: Source data folder [', dataAbsPath, ']');

    for (const drive of drives) {
        console.log(
            'Sync-To-Drive server [',
            PID,
            ']: Synching to drive [',
            drive.path,
            '] -> [',
            drive.mountpoint,
            ']'
        );

        const cmd = (() => {
            switch (process.platform) {
                case 'win32':
                    return null;
                case 'linux':
                    return [
                        'rsync',
                        '-a',
                        '--delete-before',
                        '-b',
                        '--backup-dir=' + path.join(drive.mountpoint, 'deleted'),
                        '--ignore-existing',
                        dataAbsPath,
                        path.join(drive.mountpoint, 'sync')
                    ].join(' ');
                default:
                    return null;
            }
        })();

        if (!cmd) {
            console.log('Sync-To-Drive server [', PID, ']: ERROR: No command for syncing!');

            return;
        }

        console.log('Sync-To-Drive server [', PID, ']: Executing command:', cmd);

        try {
            const spwndCmd = spawn(cmd, {
                detached: true,
                shell: true,
                stdio: 'ignore'
            });
            spwndCmd.unref();
        } catch (err) {
            console.log('Sync-To-Drive server [', PID, ']: ERROR! Couldnt start sync!');
        }
    }
};

// https://stackoverflow.com/a/58844917
const isProcessRunning = (processName) => {
    const cmd = (() => {
        switch (process.platform) {
            case 'win32':
                return 'tasklist';
            case 'darwin':
                return 'ps -ax | grep ' + processName;
            case 'linux':
                return 'ps -A';
            default:
                return false;
        }
    })();

    try {
        const result = execSync(cmd).toString();

        return result.toLowerCase().indexOf(processName.toLowerCase()) > -1;
    } catch (error) {
        return null;
    }
};

if (PLATFORM === 'win32') {
    console.error('Sync-To-Drive server [', PID, ']: Windows is currently not supported!');
    process.exit();
}

if (isProcessRunning('rsync')) {
    console.log('Sync-To-Drive server [', PID, ']: WARN: Sync in progress');
    process.exit();
}

const phpConfig = getConfigFromPHP();

if (!phpConfig) {
    process.exit();
} else if (!phpConfig.synctodrive_enabled) {
    console.log('Sync-To-Drive server [', PID, ']: WARN: Sync script was disabled by config! Aborting!');
    process.exit();
}

/* PARSE PHOTOBOOTH CONFIG */
const parsedConfig = parseConfig(phpConfig);
console.log('Sync-To-Drive server [', PID, ']: Drive names ', ...parsedConfig.drives);

/* WRITE PROCESS PID FILE */
const pidFilename = path.join(phpConfig.folders.tmp, 'synctodrive_server.pid');

fs.writeFile(pidFilename, PID, (err) => {
    if (err) {
        throw new Error('Unable to write PID file [' + pidFilename + '] - ' + err.message);
    }

    console.log('Sync-To-Drive server [', PID, ']: PID file created [', pidFilename, ']');
});

/* START LOOP */

console.log('Sync-To-Drive server [', PID, ']: Starting server for sync to drive');
console.log('Sync-To-Drive server [', PID, ']: Interval is [', phpConfig.synctodrive_interval, '] seconds');

const foreverLoop = () => {
    console.log('Sync-To-Drive server [', PID, ']: Starting sync process');

    const driveInfos = getDriveInfos(parsedConfig);

    driveInfos.forEach((element) => {
        console.log('Sync-To-Drive server [', PID, ']: Processing drive ', element.name, ' -> ', element.path);
    });

    const mountedDrives = mountDrives(driveInfos);

    mountedDrives.forEach((element) => {
        console.log('Sync-To-Drive server [', PID, ']: Mounted drive ', element.name, ' -> ', element.mountpoint);
    });

    startSync({
        dataAbsPath: parsedConfig.dataAbsPath,
        drives: mountedDrives
    });

    setTimeout(foreverLoop, phpConfig.synctodrive_interval * 1000);
};
foreverLoop();