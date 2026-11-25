const nodemailer = require('nodemailer');

function createMailer(env) {
    if (!env.SMTP_HOST) {
        if (env.NODE_ENV === 'production') {
            return async () => {
                throw new Error('SMTP_HOST is not configured');
            };
        }
        // shortcut: no SMTP in local dev prints the mail to the console; set SMTP_* to send real mail.
        return async ({ to, subject, text }) => {
            console.log(`[dev mail] to=${to} subject=${subject}\n${text}`);
        };
    }

    const port = Number(env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
    });
    const from = env.SMTP_FROM || env.SMTP_USER;

    return ({ to, subject, text }) => transport.sendMail({ from, to, subject, text });
}

module.exports = { createMailer };
