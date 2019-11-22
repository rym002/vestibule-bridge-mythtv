import * as Fuse from 'fuse.js';
import { Dictionary, flatten, keyBy, values } from 'lodash';
import { ApiTypes, masterBackend } from 'mythtv-services-api';
import { Channel, Service } from 'sd-json';
import { getMasterBackendEmitter } from './frontends';

class FuseOpt implements Fuse.FuseOptions<AffiliateChannelInfo> {
    readonly includeScore = true
    readonly caseSensitive = false
    readonly keys: { name: keyof AffiliateChannelInfo; weight: number }[];
    readonly shouldSort = true;
    readonly minMatchCharLength = 3;
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

export class ChannelLookup {
    private readonly chanNumToIndex = new Map<string, number>();
    private readonly channelNameFuseOpt = new FuseOpt('ChannelName', true)
    private channels: AffiliateChannelInfo[] = [];
    private channelNameFuse: Fuse<AffiliateChannelInfo, FuseOpt> = new Fuse(this.channels, this.channelNameFuseOpt)
    private channelInfoByChanId: Dictionary<AffiliateChannelInfo> = {}
    private channelInfoByCallSign: Dictionary<AffiliateChannelInfo> = {}
    private channelInfoByAffiliate: Dictionary<AffiliateChannelInfo> = {}
    private readonly sdjsonService?: Service
    private readonly lineupIds: string[]
    private hdSuffixes = ['HD', 'DT', ''];
    private static _instance?: ChannelLookup
    private constructor(videoSources: ApiTypes.VideoSource[]) {
        if (videoSources.length) {
            const videoSource = videoSources[0]
            this.sdjsonService = new Service(videoSource.UserId, videoSource.Password)
            this.lineupIds = videoSources.map(videoSource => {
                return 'USA-' + videoSource.LineupId.replace(':', '-')
            })
        } else {
            this.lineupIds = []
        }
    }
    static async instance(): Promise<ChannelLookup> {
        if (!this._instance) {
            const videoSources = await masterBackend.channelService.GetVideoSourceList()
            const sdSources = videoSources.VideoSources.filter(videoSource => {
                return videoSource.Grabber == 'schedulesdirect1'
            })
            this._instance = new ChannelLookup(sdSources);
            await this._instance.refreshChannelMap();
            const instance = this._instance
            const masterBackendEmitter = await getMasterBackendEmitter()
            masterBackendEmitter.on('MYTHFILLDATABASE_RAN', message => {
                instance.refreshChannelMap()
            })
        }
        return this._instance;
    }

    private async channelAffiliates(): Promise<Channel[]> {
        if (this.sdjsonService) {
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
        } else {
            return []
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
        const affiliateChannels = await this.channelAffiliates()
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
            const hdSuffix = this.hdSuffixes[index];
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
    private searchChannel(fuse: Fuse<AffiliateChannelInfo, FuseOpt>, search: string): string | undefined {
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