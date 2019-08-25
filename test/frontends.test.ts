import 'mocha';
import { MythEventFrontend, frontends, loadFrontends } from '../src/frontends'
import { expect } from 'chai'
import * as nock from 'nock';

describe('frontends', () => {
    before(async () => {
        nock("http://localhost:6544/Myth")
            .get('/GetHosts').reply(200, () => {
                return {
                    StringList: [
                        "hostgood",
                        "hostbad",
                        "hostcache"
                    ]
                };
            }).get('/GetSetting').query({
                Key: 'FrontendStatusPort',
                HostName: 'hostbad',
                Default: '6547'
            }).reply(200, () => {
                return {
                    String: '6547'
                };
            }).get('/GetSetting').query({
                Key: 'FrontendStatusPort',
                HostName: 'hostgood',
                Default: '6547'
            }).reply(200, () => {
                return {
                    String: '6547'
                };
            }).get('/GetSetting').query({
                Key: 'FrontendStatusPort',
                HostName: 'hostcache',
                Default: '6547'
            }).reply(200, () => {
                return {
                    String: '6547'
                };
            }).get('/GetSetting').query({
                Key: 'Theme',
                HostName: 'hostbad'
            }).reply(200, () => {
                return {
                    String: undefined
                };
            }).get('/GetSetting').query({
                Key: 'Theme',
                HostName: 'hostcache'
            }).reply(200, () => {
                return {
                    String: 'good'
                };
            }).get('/GetSetting').query({
                Key: 'Theme',
                HostName: 'hostgood'
            }).reply(200, () => {
                return {
                    String: 'goof'
                };
            })

        await loadFrontends();

        nock('http://hostgood:6547/Frontend')
            .get('/GetStatus').once().reply(200, () => {
                return {
                    FrontendStatus: {
                        State: {
                            state: 'WatchingLiveTV'
                        }
                    }
                }
            })
    })

    beforeEach(() => {
        nock('http://hostcache:6547/Frontend')
            .get('/GetStatus').once().reply(200, () => {
                return {
                    FrontendStatus: {
                        Name: 'testfe'
                    }
                }
            }).get('/GetStatus').once().reply(200, () => {
                return {
                    FrontendStatus: {
                        Name: 'testfe2'
                    }
                }
            }).post('/SendAction').query({
                Action: 123
            }).once().reply(200, () => {
                return {
                    bool: 'true'
                }
            }).post('/SendKey').query({
                Key: 123
            }).once().reply(200, () => {
                return {
                    bool: 'true'
                }
            })
    })
    it('should load frontends', () => {
        expect(frontends).to.have.length(2);
    })
    it('should cache getStatus', async () => {
        const frontend = frontends[0];
        const status = await frontend.GetStatus();
        const status2 = await frontend.GetStatus();
        expect(status).eql(status2);
    })
    it('should check watching tv', async () => {
        const frontend = frontends[0];
        const status = await frontend.isWatchingTv();
        expect(status).to.be.true;
    })
    it('should reset cache on SendAction', async () => {
        const frontend = frontends[1];
        const status = await frontend.GetStatus();
        await frontend.SendAction({
            Action: '123'
        }, false)
        const status2 = await frontend.GetStatus();
        expect(status).not.eql(status2);
    })
    it('should reset cache on SendKey', async () => {
        const frontend = frontends[1];
        const status = await frontend.GetStatus();
        await frontend.SendKey({
            Key: '123'
        })
        const status2 = await frontend.GetStatus();
        expect(status).not.eql(status2);
    })
})