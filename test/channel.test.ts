import 'mocha';
import { expect } from 'chai'
import nock from 'nock';
import { createSandbox } from 'sinon';
import { ChannelLookup, SqliteAffiliateProvider } from '../src/channel'
import { OPEN_READWRITE } from 'sqlite3';

describe('channelLookup', function () {
    const sandbox = createSandbox({
        useFakeTimers: true
    })
    before(function () {
        nock("http://localhost:6544/Myth")
            .get('/GetHostName')
            .reply(200, {
                String: 'hostgood'
            })
            .get('/GetSetting').query({
                Key: 'ChannelOrdering',
                Default: 'channum'
            }).reply(200, {
                String: 'channum'
            })

        nock("http://localhost:6544/Channel")
            .get('/GetChannelInfoList')
            .query({
                OnlyVisible: true,
                Details: true,
                OrderByName: false
            }).reply(200, {
                ChannelInfoList: {
                    ChannelInfos: [
                        {
                            ATSCMajorChan: 100,
                            ATSCMinorChan: 0,
                            CallSign: 'WAB',
                            ChannelName: 'Local Station',
                            ChanNum: '100',
                            ChanId: 1100
                        },
                        {
                            ATSCMajorChan: 110,
                            ATSCMinorChan: 0,
                            CallSign: 'WABHD',
                            ChannelName: 'Local Station HD',
                            ChanNum: '110',
                            ChanId: 1110
                        },
                        {
                            ATSCMajorChan: 150,
                            ATSCMinorChan: 0,
                            CallSign: 'WCB',
                            ChannelName: 'National Station',
                            ChanNum: '150',
                            ChanId: 1150
                        },
                        {
                            ATSCMajorChan: 155,
                            ATSCMinorChan: 0,
                            CallSign: 'WCBDT',
                            ChannelName: 'National Station DT',
                            ChanNum: '155',
                            ChanId: 1155
                        },
                        {
                            ATSCMajorChan: 180,
                            ATSCMinorChan: 0,
                            CallSign: 'WEB',
                            ChannelName: 'Test Station',
                            ChanNum: '180',
                            ChanId: 1180
                        },
                        {
                            ATSCMajorChan: 182,
                            ATSCMinorChan: 0,
                            CallSign: 'WEBDT',
                            ChannelName: 'Test Station DT',
                            ChanNum: '182',
                            ChanId: 1182
                        },
                        {
                            ATSCMajorChan: 185,
                            ATSCMinorChan: 0,
                            CallSign: 'WEBHD',
                            ChannelName: 'Test Station HD',
                            ChanNum: '185',
                            ChanId: 1185
                        },
                        {
                            ATSCMajorChan: 200,
                            ATSCMinorChan: 0,
                            CallSign: 'KAB',
                            ChannelName: 'Test Channel Skip',
                            ChanNum: '200.0'
                        },
                        {
                            ATSCMajorChan: 200,
                            ATSCMinorChan: 1,
                            CallSign: 'KAB2',
                            ChannelName: 'Test Channel Skip 2',
                            ChanNum: '200.1'
                        }
                    ]
                }
            })

        process.env['MYTH_SDJSON_USER'] = 'testUser'
        process.env['MYTH_SDJSON_PASSWORD_HASH'] = '82f8809f42d911d1bd5199021d69d15ea91d1fad'
        process.env['MYTH_SDJSON_LINEUPS'] = 'USA-TEST-X'
        nock('https://json.schedulesdirect.org/20141201')
            .post('/token', {
                username: 'testUser',
                password: '82f8809f42d911d1bd5199021d69d15ea91d1fad'
            })
            .reply(200, {
                token: 'testToken'
            })
            .get('/lineups/preview/USA-TEST-X')
            .reply(200, [
                {
                    channel: '001'
                },
                {
                    channel: '100',
                    callsign: 'WAB',
                    affiliate: 'AFF1'
                },
                {
                    channel: '182',
                    callsign: 'WEBDT',
                    affiliate: 'AFF1'
                }
            ])
    })
    context('affiliate', function () {
        it('should load find the channel for the affiliate id', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.searchAffiliate('AFF1')
            expect(channel).to.eq('182')
        })
    })

    context('sqlite affiliate', function () {
        beforeEach(async function () {
            const ap = new SqliteAffiliateProvider(':memory:')
            const db = await ap.getDatabase(OPEN_READWRITE)
            db.exec("create table stations ( "
                + "station varchar(128) not null primary key, "
                + "details blob not null)")
            db.exec(`INSERT INTO stations (station,details) VALUES('stat','{"affiliate":"AFF1","name":"WAB"}')`)
            db.exec(`INSERT INTO stations (station,details) VALUES('stat2','{"name":"WAB2"}')`)
            this.currentTest['ap'] = ap
        })

        it('should read from db', async function () {
            const ap = this.test['ap']
            const data = await ap.channelAffiliates()
            expect(data).length(1)
            expect(data[0]).to.have.property('affiliate', 'AFF1')
        })
    })

    context('callsign', function () {
        it('should find the callsign', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.searchCallSign('KAB2')
            expect(channel).to.eq('200.1')
        })
        it('should prefer the hd callsign', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.searchCallSign('WAB')
            expect(channel).to.eq('110')
        })
        it('should prefer the dt callsign', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.searchCallSign('WCB')
            expect(channel).to.eq('155')
        })
        it('should prefer hd over dt callsign', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.searchCallSign('WEB')
            expect(channel).to.eq('185')
        })
    })
    context('channel name', function () {
        it('should change to the hd channel name', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.searchChannelName('Local Station')
            expect(channel).to.eq('110')
        })
        it('should change to the channel name', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.searchChannelName('Test Channel Skip')
            expect(channel).to.eq('200.0')
        })
    })
    context('channel skip', function () {
        it('should channel up', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.getSkipChannelNum('150', 2)
            expect(channel).to.eq('180')
        })
        it('should channel down', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.getSkipChannelNum('150', -2)
            expect(channel).to.eq('100')
        })
        it('should wrap around channel up', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.getSkipChannelNum('150', 16)
            expect(channel).to.eq('100')
        })
        it('should wrap around channel down', async function () {
            const lookup = await ChannelLookup.instance()
            const channel = lookup.getSkipChannelNum('150', -12)
            expect(channel).to.eq('200.1')
        })
    })
})