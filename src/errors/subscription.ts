export class AlreadySubscribedError extends Error {
    constructor() {
        super('Email already subscribed to this repository');
    }
}
