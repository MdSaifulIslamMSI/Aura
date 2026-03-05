class BaseEmailProvider {
    constructor({ name }) {
        this.name = name || 'base';
    }

    // eslint-disable-next-line class-methods-use-this
    async sendTransactionalEmail() {
        throw new Error('sendTransactionalEmail must be implemented by provider');
    }
}

module.exports = BaseEmailProvider;
