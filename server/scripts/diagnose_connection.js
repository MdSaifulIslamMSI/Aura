const dns = require('dns');
const net = require('net');

const hosts = [
    'ac-x29gjzz-shard-00-00.fcpd3hx.mongodb.net',
    'ac-x29gjzz-shard-00-01.fcpd3hx.mongodb.net',
    'ac-x29gjzz-shard-00-02.fcpd3hx.mongodb.net'
];

async function checkHost(host) {
    console.log(`\nChecking ${host}...`);

    // 1. DNS Resolution
    try {
        const addresses = await dns.promises.resolve(host);
        console.log(`  DNS: Resolved to ${addresses.join(', ')}`);
    } catch (err) {
        console.error(`  DNS: Failed - ${err.message}`);
        return;
    }

    // 2. TCP Connection
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(5000);

        const startTime = Date.now();
        socket.connect(27017, host, () => {
            const time = Date.now() - startTime;
            console.log(`  TCP: Connected successfully in ${time}ms`);
            socket.destroy();
            resolve();
        });

        socket.on('error', (err) => {
            console.error(`  TCP: Failed - ${err.message}`);
            socket.destroy();
            resolve();
        });

        socket.on('timeout', () => {
            console.error(`  TCP: Timed out after 5000ms`);
            socket.destroy();
            resolve();
        });
    });
}

async function run() {
    for (const host of hosts) {
        await checkHost(host);
    }
}

run();
