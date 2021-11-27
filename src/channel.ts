import { Database, OPEN_READONLY } from '@vscode/sqlite3';
import Fuse from 'fuse.js';
import { Dictionary, flatten, keyBy, values } from 'lodash';
import { ApiTypes, masterBackend } from 'mythtv-services-api';
import { Channel, Service } from 'sd-json';
import { getMasterBackendEmitter } from './frontends';

class FuseOpt implements Fuse.IFuseOptions<AffiliateChannelInfo> {
    readonly includeScore = true
    readonly caseSensitive = false
    readonly keys: { name: keyof AffiliateChannelInfo; weight: number }[];
    readonly shouldSort = true;
    readonly minMatchCharLength = 3;
    readonly useExtendedSearch = true;
    constructor(name: keyof AffiliateChannelInfo, readonly tokenize: boolean) {
        this.keys = [
            {
                name: name,
                weight: 0.01
            }
        ]
    }
}

export interface AffiliateChannelInfo extends ApiTypes.ChannelInfo {
    affiliateName?: string
}

interface AffiliateProvider {
    channelAffiliates(): Promise<Channel[]>
}

class SdJsonAffiliateProvider implements AffiliateProvider {
    private readonly sdjsonService: Service
    constructor(userName: string, passwordHash: string, private readonly lineupIds: string[]) {
        this.sdjsonService = new Service(userName, passwordHash, true)
    }
    async channelAffiliates(): Promise<Channel[]> {
        const sdjsonService = this.sdjsonService
        const lineupPromises = this.lineupIds.map(async lineupId => {
            const ret = await sdjsonService.lineupPreview(lineupId)
            const filtered = ret.filter(lineup => {
                return lineup.affiliate != undefined
            })
            return filtered
        })
        const lineups = await Promise.all(lineupPromises)
        const channels = values(keyBy(flatten(lineups), 'channel'))
        return channels
    }
}

interface DbRow {
    details: string
}
export class SqliteAffiliateProvider implements AffiliateProvider {
    private db?: Database
    constructor(private readonly dbPath: string) {
    }

    async getDatabase(mode = OPEN_READONLY): Promise<Database> {
        if (!this.db) {
            this.db = await new Promise<Database>((resolve, reject) => {
                const db = new Database(this.dbPath, mode, (err) => {
                    if (err) {
                        reject(err)
                    }
                    resolve(db)
                })
            })
        }
        return this.db;
    }
    async channelAffiliates(): Promise<Channel[]> {
        const db = await this.getDatabase()
        const data = await new Promise<DbRow[]>((resolve, reject) => {
            db.all('SELECT details FROM stations WHERE details LIKE ?', '%affiliate%', (err: Error, rows: DbRow[]) => {
                if (err) {
                    reject(err)
                }
                resolve(rows)
            })
        })
        return data.map((record: DbRow) => {
            return JSON.parse(record.details)
        })

    }
}

class NullAffiliateProvider implements AffiliateProvider {
    async channelAffiliates(): Promise<Channel[]> {
        return []
    }

}
export class ChannelLookup {
    private readonly chanNumToIndex = new Map<string, number>();
    private readonly channelNameFuseOpt = new FuseOpt('ChannelName', true)
    private channels: AffiliateChannelInfo[] = [];
    private channelNameFuse: Fuse<AffiliateChannelInfo> = new Fuse(this.channels, this.channelNameFuseOpt)
    private channelInfoByChanId: Dictionary<AffiliateChannelInfo> = {}
    private channelInfoByCallSign: Dictionary<AffiliateChannelInfo> = {}
    private channelInfoByAffiliate: Dictionary<AffiliateChannelInfo> = {}
    private hdSuffixes = ['HD', 'DT', ''];
    private static _instance?: ChannelLookup
    private constructor(readonly affiliateProvider: AffiliateProvider) {

    }
    static async instance(): Promise<ChannelLookup> {
        if (!this._instance) {
            this._instance = new ChannelLookup(this.createAffilateProvider());
            await this._instance.refreshChannelMap();
            const instance = this._instance
            const masterBackendEmitter = await getMasterBackendEmitter()
            masterBackendEmitter.on('MYTHFILLDATABASE_RAN', message => {
                instance.refreshChannelMap()
            })
        }
        return this._instance;
    }
    static createAffilateProvider(): AffiliateProvider {
        const dbPath = process.env['MYTH_SDJSON_DB']
        const username = process.env['MYTH_SDJSON_USER']
        const passwordHash = process.env['MYTH_SDJSON_PASSWORD_HASH']
        const lineups = process.env['MYTH_SDJSON_LINEUPS']
        if (dbPath) {
            return new SqliteAffiliateProvider(dbPath)
        } else if (username && passwordHash && lineups) {
            return new SdJsonAffiliateProvider(username, passwordHash, lineups.split(','))
        } else {
            return new NullAffiliateProvider()
        }
    }
    private async mythChannelInfo(): Promise<ApiTypes.ChannelInfo[]> {
        const channelOrder = await masterBackend.mythService.GetSetting({
            Key: 'ChannelOrdering',
            Default: 'channum'
        })
        const channelInfoList = await masterBackend.channelService.GetChannelInfoList({
            OnlyVisible: true,
            Details: true,
            OrderByName: channelOrder != 'channum'
        })
        return channelInfoList.ChannelInfos
    }
    private async refreshChannelMap(): Promise<void> {
        this.channels = await this.mythChannelInfo()
        this.channelNameFuse = new Fuse(this.channels, this.channelNameFuseOpt);
        this.chanNumToIndex.clear();
        this.channels.forEach((channelInfo, index) => {
            this.chanNumToIndex.set(channelInfo.ChanNum, index);
        })
        this.channelInfoByCallSign = keyBy(this.channels, 'CallSign')
        const affiliateChannels = await this.affiliateProvider.channelAffiliates()
        affiliateChannels.forEach(channel => {
            const channelInfo = this.channelInfoByCallSign[channel.callsign]
            if (channelInfo) {
                channelInfo.affiliateName = channel.affiliate
            }
        })
        this.channelInfoByChanId = keyBy(this.channels, 'ChanId')
        this.channelInfoByAffiliate = keyBy(this.channels.filter(channelInfo => {
            return channelInfo.affiliateName != undefined
        }), 'affiliateName')
    }

    getSkipChannelNum(chanNum: string, channelCount: number): string | undefined {
        const currentIndex = this.chanNumToIndex.get(chanNum);
        if (currentIndex != undefined) {
            let nextIndex = currentIndex + channelCount;
            if (nextIndex >= this.channels.length) {
                nextIndex -= this.channels.length;
            } else if (nextIndex < 0) {
                nextIndex = this.channels.length + nextIndex;
            }
            if (nextIndex < 0 || nextIndex >= this.channels.length) {
                return this.getSkipChannelNum(this.channels[0].ChanNum, nextIndex)
            } else {
                return this.channels[nextIndex].ChanNum;
            }
        }
    }

    isValidChanNum(chanNum: string): boolean {
        return this.chanNumToIndex.get(chanNum) != undefined;
    }
    searchChannelName(chanName: string): string | undefined {
        for (let index = 0; index < this.hdSuffixes.length; index++) {
            const suffix = this.hdSuffixes[index];
            const hdSuffix = suffix ? ' ' + suffix + '$' : suffix
            const chanNum = this.searchChannel(this.channelNameFuse, chanName + ' ' + hdSuffix)
            if (chanNum) {
                return chanNum;
            }
        }
    }
    searchCallSign(callSign: string): string | undefined {
        for (let index = 0; index < this.hdSuffixes.length; index++) {
            const hdSuffix = this.hdSuffixes[index];
            const chanNum = this.channelInfoByCallSign[callSign + hdSuffix]
            if (chanNum) {
                return chanNum.ChanNum;
            }
        }
    }
    searchAffiliate(affiliate: string): string | undefined {
        const chanNum = this.channelInfoByAffiliate[affiliate]
        if (chanNum) {
            return chanNum.ChanNum;
        }
    }
    private searchChannel(fuse: Fuse<AffiliateChannelInfo>, search: string): string | undefined {
        const ret = fuse.search(search, {
            limit: 1
        })
        if (ret.length == 1) {
            return ret[0].item.ChanNum;
        }
    }

    public getChannelInfoForChanId(chanId: number) {
        return this.channelInfoByChanId[chanId]
    }
}