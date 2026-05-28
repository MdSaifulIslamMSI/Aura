const { validatePaymentEnvironment } = require('../services/payments/foundation/env');

const result = validatePaymentEnvironment(process.env);

if (result.warnings.length > 0) {
    result.warnings.forEach((warning) => {
        process.stderr.write(`payment-env warning: ${warning}\n`);
    });
}

if (!result.ok) {
    result.errors.forEach((error) => {
        process.stderr.write(`payment-env error: ${error}\n`);
    });
    process.exitCode = 1;
} else {
    process.stdout.write('Payment environment contract valid for current mode.\n');
}
