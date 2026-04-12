import NodeCache from '@cacheable/node-cache'
import { Boom } from '@hapi/boom'
import * as Utils from '../Utils/index.js'
import { proto } from '../../WAProto/index.js'
import { DEFAULT_CACHE_TTLS, WA_DEFAULT_EPHEMERAL } from '../Defaults/index.js'
import * as WABinary from '../WABinary/index.js'
import { getUrlInfo } from '../Utils/link-preview.js'
import { makeKeyedMutex } from '../Utils/make-mutex.js'
import { USyncQuery, USyncUser } from '../WAUSync/index.js'
import { makeNewsletterSocket } from './newsletter.js'
import NexusHandler from './nexus-handler.js'
import { randomBytes } from 'crypto'

const {
    aggregateMessageKeysNotFromMe, assertMediaContent, bindWaitForEvent, decryptMediaRetryData,
    encodeNewsletterMessage, encodeSignedDeviceIdentity, encodeWAMessage, encryptMediaRetryRequest,
    extractDeviceJids, generateMessageIDV2, generateParticipantHashV2, generateWAMessage,
    getStatusCodeForMediaRetry, getUrlFromDirectPath, getWAUploadToServer, MessageRetryManager,
    normalizeMessageContent, parseAndInjectE2ESessions, prepareStickerPackMessage, unixTimestampSeconds,
    generateWAMessageFromContent, delay, generateMessageID
} = Utils

const {
    areJidsSameUser, getBinaryNodeChild, getBinaryNodeChildren, isHostedLidUser, isHostedPnUser,
    isJidGroup, isLidUser, isPnUser, jidDecode, jidEncode, jidNormalizedUser, S_WHATSAPP_NET,
    getBinaryFilteredButtons, STORIES_JID, isJidUser, isJidNewsletter
} = WABinary

const resolveSendTargetJid = (jid, quoted) => {
    const normalizedJid = jidNormalizedUser(jid)
    const quotedJid = quoted?.key?.remoteJid ? jidNormalizedUser(quoted.key.remoteJid) : null

    if (!quotedJid) {
        return normalizedJid
    }

    if (isJidGroup(quotedJid) && !isJidGroup(normalizedJid)) {
        return quotedJid
    }

    const quotedParticipant = quoted?.participant || quoted?.key?.participant
    const normalizedParticipant = quotedParticipant ? jidNormalizedUser(quotedParticipant) : null
    if (normalizedParticipant && areJidsSameUser(normalizedParticipant, normalizedJid)) {
        return quotedJid
    }

    return normalizedJid
}

export const makeMessagesSocket = (config) => {
    const {
        logger, linkPreviewImageThumbnailWidth, generateHighQualityLinkPreview,
        options: httpRequestOptions, patchMessageBeforeSending, cachedGroupMetadata,
        enableRecentMessageCache, maxMsgRetryCount
    } = config

    const sock = makeNewsletterSocket(config)
    const {
        ev, authState, processingMutex, signalRepository, upsertMessage, query,
        fetchPrivacySettings, sendNode, groupMetadata, groupToggleEphemeral
    } = sock

    const userDevicesCache = config.userDevicesCache || new NodeCache({
        stdTTL: DEFAULT_CACHE_TTLS.USER_DEVICES,
        useClones: false
    })

    const peerSessionsCache = new NodeCache({
        stdTTL: DEFAULT_CACHE_TTLS.USER_DEVICES,
        useClones: false
    })

    const messageRetryManager = enableRecentMessageCache 
        ? new MessageRetryManager(logger, maxMsgRetryCount) 
        : null

    const encryptionMutex = makeKeyedMutex()
    let mediaConn

    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn
        if (!media || forceGet || Date.now() - media.fetchDate.getTime() > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: { type: 'set', xmlns: 'w:m', to: S_WHATSAPP_NET },
                    content: [{ tag: 'media_conn', attrs: {} }]
                })
                const mediaConnNode = getBinaryNodeChild(result, 'media_conn')
                const node = {
                    hosts: getBinaryNodeChildren(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                }
                logger.debug('fetched media conn')
                return node
            })()
        }
        return mediaConn
    }

    const sendReceipt = async (jid, participant, messageIds, type) => {
        if (!messageIds?.length) throw new Boom('missing ids in receipt')

        const node = {
            tag: 'receipt',
            attrs: { id: messageIds[0] }
        }

        const isReadReceipt = type === 'read' || type === 'read-self'
        if (isReadReceipt) node.attrs.t = unixTimestampSeconds().toString()

        if (type === 'sender' && (isPnUser(jid) || isLidUser(jid))) {
            node.attrs.recipient = jid
            node.attrs.to = participant
        } else {
            node.attrs.to = jid
            if (participant) node.attrs.participant = participant
        }

        if (type) node.attrs.type = type

        const remainingMessageIds = messageIds.slice(1)
        if (remainingMessageIds.length) {
            node.content = [{
                tag: 'list',
                attrs: {},
                content: remainingMessageIds.map(id => ({ tag: 'item', attrs: { id } }))
            }]
        }

        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt')
        await sendNode(node)
    }

    const sendReceipts = async (keys, type) => {
        const recps = aggregateMessageKeysNotFromMe(keys)
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type)
        }
    }

    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings()
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self'
        await sendReceipts(keys, readType)
    }

    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        const deviceResults = []
        if (!useCache) logger.debug('not using cache for devices')

        const toFetch = []
        const jidsWithUser = jids
            .map(jid => {
                const decoded = jidDecode(jid)
                const user = decoded?.user
                const device = decoded?.device
                const isExplicitDevice = typeof device === 'number' && device >= 0

                if (isExplicitDevice && user) {
                    deviceResults.push({ user, device, jid })
                    return null
                }

                jid = jidNormalizedUser(jid)
                return { jid, user }
            })
            .filter(Boolean)

        let mgetDevices
        if (useCache && userDevicesCache.mget) {
            const usersToFetch = jidsWithUser.map(j => j?.user).filter(Boolean)
            mgetDevices = await userDevicesCache.mget(usersToFetch)
        }

        for (const { jid, user } of jidsWithUser) {
            if (useCache) {
                const devices = mgetDevices?.[user] || (userDevicesCache.mget ? undefined : await userDevicesCache.get(user))
                if (devices) {
                    deviceResults.push(...devices.map(d => ({ ...d, jid: jidEncode(d.user, d.server, d.device) })))
                    logger.trace({ user }, 'using cache for devices')
                } else {
                    toFetch.push(jid)
                }
            } else {
                toFetch.push(jid)
            }
        }

        if (!toFetch.length) return deviceResults

        const requestedLidUsers = new Set()
        for (const jid of toFetch) {
            if (isLidUser(jid) || isHostedLidUser(jid)) {
                const user = jidDecode(jid)?.user
                if (user) requestedLidUsers.add(user)
            }
        }

        const query = new USyncQuery().withContext('message').withDeviceProtocol().withLIDProtocol()
        for (const jid of toFetch) {
            query.withUser(new USyncUser().withId(jid))
        }

        const result = await sock.executeUSyncQuery(query)
        if (result) {
            const lidResults = result.list.filter(a => !!a.lid)
            if (lidResults.length > 0) {
                logger.trace('Storing LID maps from device call')
                await signalRepository.lidMapping.storeLIDPNMappings(
                    lidResults.map(a => ({ lid: a.lid, pn: a.id }))
                )
            }

            const extracted = extractDeviceJids(
                result?.list,
                authState.creds.me.id,
                authState.creds.me.lid,
                ignoreZeroDevices
            )

            const deviceMap = {}
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || []
                deviceMap[item.user]?.push(item)
            }

            for (const [user, userDevices] of Object.entries(deviceMap)) {
                const isLidUser = requestedLidUsers.has(user)
                for (const item of userDevices) {
                    const finalJid = isLidUser
                        ? jidEncode(user, item.server, item.device)
                        : jidEncode(item.user, item.server, item.device)
                    deviceResults.push({ ...item, jid: finalJid })
                }
            }

            if (userDevicesCache.mset) {
                await userDevicesCache.mset(Object.entries(deviceMap).map(([key, value]) => ({ key, value })))
            } else {
                for (const key in deviceMap) {
                    if (deviceMap[key]) await userDevicesCache.set(key, deviceMap[key])
                }
            }

            const userDeviceUpdates = {}
            for (const [userId, devices] of Object.entries(deviceMap)) {
                if (devices?.length > 0) {
                    userDeviceUpdates[userId] = devices.map(d => d.device?.toString() || '0')
                }
            }

            if (Object.keys(userDeviceUpdates).length > 0) {
                try {
                    await authState.keys.set({ 'device-list': userDeviceUpdates })
                    logger.debug({ userCount: Object.keys(userDeviceUpdates).length }, 'stored user device lists')
                } catch (error) {
                    logger.warn({ error }, 'failed to store user device lists')
                }
            }
        }

        return deviceResults
    }

    const assertSessions = async (jids) => {
        let didFetchNewSession = false
        const uniqueJids = [...new Set(jids)]
        const jidsRequiringFetch = []

        for (const jid of uniqueJids) {
            const signalId = signalRepository.jidToSignalProtocolAddress(jid)
            const cachedSession = peerSessionsCache.get(signalId)

            if (cachedSession !== undefined) {
                if (cachedSession) continue
            } else {
                const sessionValidation = await signalRepository.validateSession(jid)
                const hasSession = sessionValidation.exists
                peerSessionsCache.set(signalId, hasSession)
                if (hasSession) continue
            }

            jidsRequiringFetch.push(jid)
        }

        if (jidsRequiringFetch.length) {
            const wireJids = [
                ...jidsRequiringFetch.filter(jid => isLidUser(jid) || isHostedLidUser(jid)),
                ...(await signalRepository.lidMapping.getLIDsForPNs(
                    jidsRequiringFetch.filter(jid => isPnUser(jid) || isHostedPnUser(jid))
                ) || []).map(a => a.lid)
            ]

            logger.debug({ jidsRequiringFetch, wireJids }, 'fetching sessions')
            const result = await query({
                tag: 'iq',
                attrs: { xmlns: 'encrypt', type: 'get', to: S_WHATSAPP_NET },
                content: [{
                    tag: 'key',
                    attrs: {},
                    content: wireJids.map(jid => ({ tag: 'user', attrs: { jid } }))
                }]
            })

            await parseAndInjectE2ESessions(result, signalRepository)
            didFetchNewSession = true

            for (const wireJid of wireJids) {
                const signalId = signalRepository.jidToSignalProtocolAddress(wireJid)
                peerSessionsCache.set(signalId, true)
            }
        }

        return didFetchNewSession
    }

    const sendPeerDataOperationMessage = async (pdoMessage) => {
        if (!authState.creds.me?.id) throw new Boom('Not authenticated')

        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        }

        const meJid = jidNormalizedUser(authState.creds.me.id)
        return await relayMessage(meJid, protocolMessage, {
            additionalAttributes: { category: 'peer', push_priority: 'high_force' },
            additionalNodes: [{ tag: 'meta', attrs: { appdata: 'default' } }]
        })
    }

    const createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
        if (!recipientJids.length) return { nodes: [], shouldIncludeDeviceIdentity: false }

        const patched = await patchMessageBeforeSending(message, recipientJids)
        const patchedMessages = Array.isArray(patched)
            ? patched
            : recipientJids.map(jid => ({ recipientJid: jid, message: patched }))

        let shouldIncludeDeviceIdentity = false
        const meId = authState.creds.me.id
        const meLid = authState.creds.me?.lid
        const meLidUser = meLid ? jidDecode(meLid)?.user : null

        const encryptionPromises = patchedMessages.map(async ({ recipientJid: jid, message: patchedMessage }) => {
            if (!jid) return null

            let msgToEncrypt = patchedMessage
            if (dsmMessage) {
                const { user: targetUser } = jidDecode(jid)
                const { user: ownPnUser } = jidDecode(meId)
                const isOwnUser = targetUser === ownPnUser || (meLidUser && targetUser === meLidUser)
                const isExactSenderDevice = jid === meId || (meLid && jid === meLid)

                if (isOwnUser && !isExactSenderDevice) {
                    msgToEncrypt = dsmMessage
                    logger.debug({ jid, targetUser }, 'Using DSM for own device')
                }
            }

            const bytes = encodeWAMessage(msgToEncrypt)
            return await encryptionMutex.mutex(jid, async () => {
                const { type, ciphertext } = await signalRepository.encryptMessage({ jid, data: bytes })
                if (type === 'pkmsg') shouldIncludeDeviceIdentity = true
                return {
                    tag: 'to',
                    attrs: { jid },
                    content: [{ tag: 'enc', attrs: { v: '2', type, ...(extraAttrs || {}) }, content: ciphertext }]
                }
            })
        })

        const nodes = (await Promise.all(encryptionPromises)).filter(Boolean)
        return { nodes, shouldIncludeDeviceIdentity }
    }

    const getMessageType = (msg) => {
        const message = normalizeMessageContent(msg)
        if (message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3) return 'poll'
        if (message.reactionMessage) return 'reaction'
        if (message.eventMessage) return 'event'
        if (getMediaType(message)) return 'media'
        return 'text'
    }

    const getMediaType = (message) => {
        if (message.imageMessage) return 'image'
        if (message.stickerMessage) {
            return message.stickerMessage.isLottie ? '1p_sticker' 
                : message.stickerMessage.isAvatar ? 'avatar_sticker' : 'sticker'
        }
        if (message.videoMessage) return message.videoMessage.gifPlayback ? 'gif' : 'video'
        if (message.audioMessage) return message.audioMessage.ptt ? 'ptt' : 'audio'
        if (message.ptvMessage) return 'ptv'
        if (message.albumMessage) return 'collection'
        if (message.contactMessage) return 'vcard'
        if (message.documentMessage) return 'document'
        if (message.stickerPackMessage) return 'sticker_pack'
        if (message.contactsArrayMessage) return 'contact_array'
        if (message.locationMessage) return 'location'
        if (message.liveLocationMessage) return 'livelocation'
        if (message.listMessage) return 'list'
        if (message.listResponseMessage) return 'list_response'
        if (message.buttonsResponseMessage) return 'buttons_response'
        if (message.orderMessage) return 'order'
        if (message.productMessage) return 'product'
        if (message.interactiveResponseMessage) return 'native_flow_response'
        if (/https:\/\/wa\.me\/c\/\d+/.test(message.extendedTextMessage?.text)) return 'cataloglink'
        if (/https:\/\/wa\.me\/p\/\d+\/\d+/.test(message.extendedTextMessage?.text)) return 'productlink'
        if (message.extendedTextMessage?.matchedText || message.groupInviteMessage) return 'url'
    }

    const getButtonType = (message) => {
        if (message.listMessage) return 'list'
        if (message.buttonsMessage) return 'buttons'
        const btn = message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name
        if (['review_and_pay', 'review_order', 'payment_info', 'payment_status', 'payment_method'].includes(btn)) return btn
        if (message.interactiveMessage?.nativeFlowMessage) return 'interactive'
    }

    const getButtonArgs = (message) => {
        const msgContent = message.viewOnceMessage?.message || message
        const flowMsg = msgContent.interactiveMessage?.nativeFlowMessage
        const btnFirst = flowMsg?.buttons?.[0]?.name
        const specialBtns = ['mpm', 'cta_catalog', 'send_location', 'call_permission_request', 
            'wa_payment_transaction_details', 'automated_greeting_message_view_catalog']

        const base = {
            tag: 'biz',
            attrs: {
                actual_actors: '2',
                host_storage: '2',
                privacy_mode_ts: unixTimestampSeconds().toString()
            }
        }

        if (flowMsg && (btnFirst === 'review_and_pay' || btnFirst === 'payment_info')) {
            return {
                tag: 'biz',
                attrs: { native_flow_name: btnFirst === 'review_and_pay' ? 'order_details' : btnFirst }
            }
        }

        if (flowMsg && specialBtns.includes(btnFirst)) {
            return {
                ...base,
                content: [
                    { tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, 
                        content: [{ tag: 'native_flow', attrs: { v: '2', name: btnFirst } }] },
                    { tag: 'quality_control', attrs: { source_type: 'third_party' } }
                ]
            }
        }

        if (flowMsg || msgContent.buttonsMessage) {
            return {
                ...base,
                content: [
                    { tag: 'interactive', attrs: { type: 'native_flow', v: '1' },
                        content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] },
                    { tag: 'quality_control', attrs: { source_type: 'third_party' } }
                ]
            }
        }

        if (msgContent.listMessage) {
            return {
                ...base,
                content: [
                    { tag: 'list', attrs: { v: '2', type: 'product_list' } },
                    { tag: 'quality_control', attrs: { source_type: 'third_party' } }
                ]
            }
        }

        return base
    }

    const relayMessage = async (jid, message, { 
        messageId: msgId, participant, additionalAttributes, additionalNodes, 
        useUserDevicesCache, useCachedGroupMetadata, statusJidList 
    } = {}) => {
        const meId = authState.creds.me.id
        const meLid = authState.creds.me?.lid
        const isRetryResend = Boolean(participant?.jid)
        let shouldIncludeDeviceIdentity = isRetryResend

        const { user, server } = jidDecode(jid)
        const isGroup = server === 'g.us'
        const isStatus = jid === 'status@broadcast'
        const isLid = server === 'lid'
        const isNewsletter = server === 'newsletter'

        msgId = msgId || generateMessageIDV2(meId)
        useUserDevicesCache = useUserDevicesCache !== false
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus

        const participants = []
        const destinationJid = !isStatus ? jid : 'status@broadcast'
        const binaryNodeContent = []
        const devices = []

        const meMsg = {
            deviceSentMessage: { destinationJid, message },
            messageContextInfo: message.messageContextInfo
        }

        const extraAttrs = {}
        const messages = normalizeMessageContent(message)
        const buttonType = getButtonType(messages)

        if (participant) {
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, device_fanout: 'false' }
            }
            const { user, device } = jidDecode(participant.jid)
            devices.push({ user, device, jid: participant.jid })
        }

        await authState.keys.transaction(async () => {
            const mediaType = getMediaType(message)
            if (mediaType) extraAttrs.mediatype = mediaType

            if (isNewsletter) {
                const patched = patchMessageBeforeSending ? await patchMessageBeforeSending(message, []) : message
                const bytes = encodeNewsletterMessage(patched)
                binaryNodeContent.push({ tag: 'plaintext', attrs: {}, content: bytes })

                const stanza = {
                    tag: 'message',
                    attrs: { to: jid, id: msgId, type: getMessageType(message), ...(additionalAttributes || {}) },
                    content: binaryNodeContent
                }

                logger.debug({ msgId }, `sending newsletter message to ${jid}`)
                await sendNode(stanza)
                return
            }

            if (messages.pinInChatMessage || messages.keepInChatMessage || 
                message.reactionMessage || message.protocolMessage?.editedMessage) {
                extraAttrs['decrypt-fail'] = 'hide'
            }

            if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata 
                            ? await cachedGroupMetadata(jid) : undefined
                        if (groupData?.participants) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata')
                        } else if (!isStatus) {
                            groupData = await groupMetadata(jid)
                        }
                        return groupData
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid])
                            return result[jid] || {}
                        }
                        return {}
                    })()
                ])

                if (!participant) {
                    const participantsList = []
                    if (isStatus) {
                        if (statusJidList?.length) participantsList.push(...statusJidList)
                    } else {
                        let groupAddressingMode = 'lid'
                        if (groupData) {
                            participantsList.push(...groupData.participants.map(p => p.id))
                            groupAddressingMode = groupData?.addressingMode || groupAddressingMode
                        }
                        additionalAttributes = { ...additionalAttributes, addressing_mode: groupAddressingMode }
                    }

                    const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false)
                    devices.push(...additionalDevices)
                }

                if (groupData?.ephemeralDuration > 0) {
                    additionalAttributes = { 
                        ...additionalAttributes, 
                        expiration: groupData.ephemeralDuration.toString() 
                    }
                }

                const patched = await patchMessageBeforeSending(message)
                if (Array.isArray(patched)) throw new Boom('Per-jid patching not supported in groups')

                const bytes = encodeWAMessage(patched)
                const groupAddressingMode = additionalAttributes?.addressing_mode || groupData?.addressingMode || 'lid'
                const groupSenderIdentity = groupAddressingMode === 'lid' && meLid ? meLid : meId

                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId: groupSenderIdentity
                })

                const senderKeyRecipients = []
                for (const device of devices) {
                    const deviceJid = device.jid
                    const hasKey = !!senderKeyMap[deviceJid]
                    if ((!hasKey || !!participant) && !isHostedLidUser(deviceJid) && 
                        !isHostedPnUser(deviceJid) && device.device !== 99) {
                        senderKeyRecipients.push(deviceJid)
                        senderKeyMap[deviceJid] = true
                    }
                }

                if (senderKeyRecipients.length) {
                    logger.debug({ senderKeyJids: senderKeyRecipients }, 'sending sender key')
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    }

                    await assertSessions(senderKeyRecipients)
                    const result = await createParticipantNodes(senderKeyRecipients, senderKeyMsg, extraAttrs)
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity
                    participants.push(...result.nodes)
                }

                if (isRetryResend) {
                    const { type, ciphertext: encryptedContent } = await signalRepository.encryptMessage({
                        data: bytes,
                        jid: participant?.jid
                    })
                    binaryNodeContent.push({
                        tag: 'enc',
                        attrs: { v: '2', type, count: participant.count.toString() },
                        content: encryptedContent
                    })
                } else {
                    binaryNodeContent.push({
                        tag: 'enc',
                        attrs: { v: '2', type: 'skmsg', ...extraAttrs },
                        content: ciphertext
                    })
                    await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } })
                }
            } else {
                let ownId = meId
                if (isLid && meLid) {
                    ownId = meLid
                    logger.debug({ to: jid, ownId }, 'Using LID identity')
                }

                const { user: ownUser } = jidDecode(ownId)

                if (!participant) {
                    const targetUserServer = isLid ? 'lid' : 's.whatsapp.net'
                    devices.push({ user, device: 0, jid: jidEncode(user, targetUserServer, 0) })

                    if (user !== ownUser) {
                        const ownUserServer = isLid ? 'lid' : 's.whatsapp.net'
                        const ownUserForAddressing = isLid && meLid ? jidDecode(meLid).user : jidDecode(meId).user
                        devices.push({ user: ownUserForAddressing, device: 0, jid: jidEncode(ownUserForAddressing, ownUserServer, 0) })
                    }

                    if (additionalAttributes?.category !== 'peer') {
                        devices.length = 0
                        const senderIdentity = isLid && meLid
                            ? jidEncode(jidDecode(meLid)?.user, 'lid', undefined)
                            : jidEncode(jidDecode(meId)?.user, 's.whatsapp.net', undefined)
                        const sessionDevices = await getUSyncDevices([senderIdentity, jid], true, false)
                        devices.push(...sessionDevices)
                    }
                }

                const allRecipients = []
                const meRecipients = []
                const otherRecipients = []
                const { user: mePnUser } = jidDecode(meId)
                const { user: meLidUser } = meLid ? jidDecode(meLid) : { user: null }

                for (const { user, jid } of devices) {
                    const isExactSenderDevice = jid === meId || (meLid && jid === meLid)
                    if (isExactSenderDevice) continue

                    const isMe = user === mePnUser || user === meLidUser
                    if (isMe) {
                        meRecipients.push(jid)
                    } else {
                        otherRecipients.push(jid)
                    }
                    allRecipients.push(jid)
                }

                await assertSessions(allRecipients)

                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, 
                       { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meRecipients, meMsg || message, extraAttrs),
                    createParticipantNodes(otherRecipients, message, extraAttrs, meMsg)
                ])

                participants.push(...meNodes, ...otherNodes)

                if (meRecipients.length > 0 || otherRecipients.length > 0) {
                    extraAttrs.phash = generateParticipantHashV2([...meRecipients, ...otherRecipients])
                }

                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2
            }

            if (participants.length) {
                if (additionalAttributes?.category === 'peer') {
                    const peerNode = participants[0]?.content?.[0]
                    if (peerNode) binaryNodeContent.push(peerNode)
                } else {
                    binaryNodeContent.push({ tag: 'participants', attrs: {}, content: participants })
                }
            }

            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    to: destinationJid,
                    type: getMessageType(message),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            }

            if (participant) {
                if (isJidGroup(destinationJid)) {
                    stanza.attrs.to = destinationJid
                    stanza.attrs.participant = participant.jid
                } else if (areJidsSameUser(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid
                    stanza.attrs.recipient = destinationJid
                } else {
                    stanza.attrs.to = participant.jid
                }
            } else {
                stanza.attrs.to = destinationJid
            }

            let additionalAlready = false
            if (!isNewsletter && buttonType) {
                const buttonsNode = getButtonArgs(messages)
                const filteredButtons = getBinaryFilteredButtons(additionalNodes || [])
                if (filteredButtons) {
                    stanza.content.push(...additionalNodes)
                    additionalAlready = true
                } else {
                    stanza.content.push(buttonsNode)
                }
            }

            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: encodeSignedDeviceIdentity(authState.creds.account, true)
                })
                logger.debug({ jid }, 'adding device identity')
            }

            if (additionalNodes?.length > 0 && !additionalAlready) {
                stanza.content.push(...additionalNodes)
            }

            logger.debug({ msgId }, `sending message to ${participants.length} devices`)
            await sendNode(stanza)

            if (messageRetryManager && !participant) {
                messageRetryManager.addRecentMessage(destinationJid, msgId, message)
            }
        }, meId)

        return msgId
    }

    const getPrivacyTokens = async (jids) => {
        const t = unixTimestampSeconds().toString()
        return await query({
            tag: 'iq',
            attrs: { to: S_WHATSAPP_NET, type: 'set', xmlns: 'privacy' },
            content: [{
                tag: 'tokens',
                attrs: {},
                content: jids.map(jid => ({
                    tag: 'token',
                    attrs: { jid: jidNormalizedUser(jid), t, type: 'trusted_contact' }
                }))
            }]
        })
    }

    const waUploadToServer = getWAUploadToServer(config, refreshMediaConn)
    const nexus = new NexusHandler(Utils, waUploadToServer, relayMessage, {
        logger,
        mediaCache: config.mediaCache,
        options: config.options,
        mediaUploadTimeoutMs: config.mediaUploadTimeoutMs
    })

    const waitForMsgMediaUpdate = bindWaitForEvent(ev, 'messages.media-update')

    return {
        ...sock,
        getPrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        nexus,
        readMessages,
        refreshMediaConn,
        waUploadToServer,
        fetchPrivacySettings,
        sendPeerDataOperationMessage,
        createParticipantNodes,
        getUSyncDevices,
        messageRetryManager,

        updateMediaMessage: async (message) => {
            const content = assertMediaContent(message.message)
            const mediaKey = content.mediaKey
            const meId = authState.creds.me.id
            const node = await encryptMediaRetryRequest(message.key, mediaKey, meId)
            let error

            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(async (update) => {
                    const result = update.find(c => c.key.id === message.key.id)
                    if (result) {
                        if (result.error) {
                            error = result.error
                        } else {
                            try {
                                const media = await decryptMediaRetryData(result.media, mediaKey, result.key.id)
                                if (media.result !== proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = proto.MediaRetryNotification.ResultType[media.result]
                                    throw new Boom(`Media re-upload failed (${resultStr})`, {
                                        data: media,
                                        statusCode: getStatusCodeForMediaRetry(media.result) || 404
                                    })
                                }
                                content.directPath = media.directPath
                                content.url = getUrlFromDirectPath(content.directPath)
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful')
                            } catch (err) {
                                error = err
                            }
                        }
                        return true
                    }
                })
            ])

            if (error) throw error

            ev.emit('messages.update', [{ key: message.key, update: { message: message.message } }])
            return message
        },

        sendStatusMentions: async (content, jids = []) => {
            const userJid = jidNormalizedUser(authState.creds.me.id)
            const allUsers = new Set([userJid])

            for (const id of jids) {
                if (isJidGroup(id)) {
                    try {
                        const metadata = await cachedGroupMetadata(id) || await groupMetadata(id)
                        metadata.participants.forEach(p => allUsers.add(jidNormalizedUser(p.id)))
                    } catch (error) {
                        logger.error(`Error getting metadata for ${id}: ${error}`)
                    }
                } else if (isJidUser(id)) {
                    allUsers.add(jidNormalizedUser(id))
                }
            }

            const uniqueUsers = Array.from(allUsers)
            const getRandomHex = () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')

            const isMedia = content.image || content.video || content.audio
            const isAudio = !!content.audio

            const msgContent = { ...content }

            if (isMedia && !isAudio) {
                if (msgContent.text) {
                    msgContent.caption = msgContent.text
                    delete msgContent.text
                }
                delete msgContent.ptt
                delete msgContent.font
                delete msgContent.backgroundColor
                delete msgContent.textColor
            }

            if (isAudio) {
                delete msgContent.text
                delete msgContent.caption
                delete msgContent.font
                delete msgContent.textColor
            }

            const font = !isMedia ? (content.font || Math.floor(Math.random() * 9)) : undefined
            const textColor = !isMedia ? (content.textColor || getRandomHex()) : undefined
            const backgroundColor = (!isMedia || isAudio) ? (content.backgroundColor || getRandomHex()) : undefined
            const ptt = isAudio ? (typeof content.ptt === 'boolean' ? content.ptt : true) : undefined

            let msg, mediaHandle
            try {
                msg = await generateWAMessage(STORIES_JID, msgContent, {
                    logger,
                    userJid,
                    getUrlInfo: text => getUrlInfo(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: { timeout: 3000, ...(httpRequestOptions || {}) },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    upload: async (encFilePath, opts) => {
                        const up = await waUploadToServer(encFilePath, { ...opts })
                        mediaHandle = up.handle
                        return up
                    },
                    mediaCache: config.mediaCache,
                    options: config.options,
                    font,
                    textColor,
                    backgroundColor,
                    ptt
                })
            } catch (error) {
                logger.error(`Error generating message: ${error}`)
                throw error
            }

            await relayMessage(STORIES_JID, msg.message, {
                messageId: msg.key.id,
                statusJidList: uniqueUsers,
                additionalNodes: [{
                    tag: 'meta',
                    attrs: {},
                    content: [{
                        tag: 'mentioned_users',
                        attrs: {},
                        content: jids.map(jid => ({ tag: 'to', attrs: { jid: jidNormalizedUser(jid) } }))
                    }]
                }]
            })

            for (const id of jids) {
                try {
                    const normalizedId = jidNormalizedUser(id)
                    const isPrivate = isJidUser(normalizedId)
                    const type = isPrivate ? 'statusMentionMessage' : 'groupStatusMentionMessage'

                    const protocolMessage = {
                        [type]: {
                            message: { protocolMessage: { key: msg.key, type: 25 } }
                        },
                        messageContextInfo: { messageSecret: randomBytes(32) }
                    }

                    const statusMsg = await generateWAMessageFromContent(normalizedId, protocolMessage, {})

                    await relayMessage(normalizedId, statusMsg.message, {
                        additionalNodes: [{
                            tag: 'meta',
                            attrs: isPrivate ? { is_status_mention: 'true' } : { is_group_status_mention: 'true' }
                        }]
                    })

                    await delay(2000)
                } catch (error) {
                    logger.error(`Error sending to ${id}: ${error}`)
                }
            }

            return msg
        },

        sendAlbumMessage: async (jid, medias, options = {}) => {
            const userJid = authState.creds.me.id
            for (const media of medias) {
                if (!media.image && !media.video) throw new TypeError('medias[i] must have image or video')
            }
            if (medias.length < 2) throw new RangeError('Minimum 2 media')

            const time = options.delay || 500
            delete options.delay

            const album = await generateWAMessageFromContent(jid, {
                albumMessage: {
                    expectedImageCount: medias.filter(m => m.image).length,
                    expectedVideoCount: medias.filter(m => m.video).length,
                    ...options
                }
            }, { userJid, ...options })

            await relayMessage(jid, album.message, { messageId: album.key.id })

            let msg
            for (const media of medias) {
                const type = media.image ? 'image' : 'video'
                msg = await generateWAMessage(jid, { [type]: media[type], ...media, ...options }, {
                    userJid,
                    upload: async (readStream, opts) => {
                        return await waUploadToServer(readStream, { 
                            ...opts, 
                            newsletter: isJidNewsletter(jid) 
                        })
                    },
                    ...options
                })

                if (msg) {
                    msg.message.messageContextInfo = {
                        messageSecret: randomBytes(32),
                        messageAssociation: { associationType: 1, parentMessageKey: album.key }
                    }
                }

                await relayMessage(jid, msg.message, { messageId: msg.key.id })
                await delay(time)
            }

            return album
        },

        stickerPackMessage: async (jid, stickerPack, options = {}) => {
            const userJid = authState.creds.me.id
            const { quoted } = options

            if (!stickerPack.stickers?.length) {
                throw new Error('Sticker pack must have at least one sticker')
            }

            const result = await prepareStickerPackMessage(stickerPack, {
                logger,
                upload: waUploadToServer,
                mediaCache: config.mediaCache,
                options: config.options,
                mediaUploadTimeoutMs: config.mediaUploadTimeoutMs
            })

            const sendPack = async (stickerPackMsg) => {
                const fullMsg = await generateWAMessageFromContent(
                    jid,
                    { stickerPackMessage: stickerPackMsg },
                    { userJid, quoted }
                )

                await relayMessage(jid, fullMsg.message, { messageId: fullMsg.key.id })

                if (config.emitOwnEvents) {
                    process.nextTick(() => {
                        processingMutex.mutex(() => upsertMessage(fullMsg, 'append'))
                    })
                }

                return fullMsg
            }

            if (result.isBatched) {
                logger.info(`Sending ${result.batchCount} batches`)
                const sentMessages = []

                for (let i = 0; i < result.stickerPackMessage.length; i++) {
                    const fullMsg = await sendPack(result.stickerPackMessage[i])
                    sentMessages.push(fullMsg)

                    if (i < result.stickerPackMessage.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000))
                    }
                }

                return sentMessages[sentMessages.length - 1]
            }

            return await sendPack(result.stickerPackMessage)
        },

        sendMessage: async (jid, content, options = {}) => {
            const resolvedJid = resolveSendTargetJid(jid, options?.quoted)
            const userJid = authState.creds.me.id
            const { filter = false, quoted } = options
            const getParticipantAttr = () => filter ? { participant: { jid: resolvedJid } } : {}
            const messageType = nexus.detectType(content)

            if (messageType) {
                switch (messageType) {
                    case 'PAYMENT':
                        return await nexus.handlePayment(content, resolvedJid, quoted)
                    
                    case 'PRODUCT':
                        return await nexus.handleProduct(content, resolvedJid, quoted)
                    
                    case 'INTERACTIVE':
                        return await nexus.handleInteractive(content, resolvedJid, quoted)

                    case 'ALBUM':
                        return await nexus.handleAlbum(content, resolvedJid, quoted)

                    case 'EVENT':
                        return await nexus.handleEvent(content, resolvedJid, quoted)

                    case 'POLL_RESULT':
                        return await nexus.handlePollResult(content, resolvedJid, quoted)

                    case 'CAROUSEL':
                        return await nexus.handleCarousel(content, resolvedJid, quoted)

                    case 'STICKER_PACK':
                        return await nexus.handleStickerPack(content.stickerPack, resolvedJid, quoted)

                    case 'CAROUSEL_PROTO':
                        return await nexus.handleCarouselProto(content, resolvedJid, quoted)
                }
            }

            if (typeof content === 'object' && 'disappearingMessagesInChat' in content && isJidGroup(resolvedJid)) {
                const { disappearingMessagesInChat } = content
                const value = typeof disappearingMessagesInChat === 'boolean'
                    ? disappearingMessagesInChat ? WA_DEFAULT_EPHEMERAL : 0
                    : disappearingMessagesInChat
                await groupToggleEphemeral(resolvedJid, value)
            } else {
                const fullMsg = await generateWAMessage(resolvedJid, content, {
                    logger,
                    userJid,
                    getUrlInfo: text => getUrlInfo(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: { timeout: 3000, ...(httpRequestOptions || {}) },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    getProfilePicUrl: sock.profilePictureUrl,
                    getCallLink: sock.createCallLink,
                    upload: waUploadToServer,
                    mediaCache: config.mediaCache,
                    options: config.options,
                    messageId: generateMessageIDV2(sock.user?.id),
                    ...options
                })

                const isDeleteMsg = 'delete' in content && !!content.delete
                const isEditMsg = 'edit' in content && !!content.edit
                const isPinMsg = 'pin' in content && !!content.pin
                const isPollMessage = 'poll' in content && !!content.poll
                const isEventMsg = 'event' in content && !!content.event

                const additionalAttributes = {}
                const additionalNodes = []

                if (isDeleteMsg) {
                    additionalAttributes.edit = isJidGroup(content.delete?.remoteJid) && !content.delete?.fromMe ? '8' : '7'
                } else if (isEditMsg) {
                    additionalAttributes.edit = '1'
                } else if (isPinMsg) {
                    additionalAttributes.edit = '2'
                } else if (isPollMessage) {
                    additionalNodes.push({ tag: 'meta', attrs: { polltype: 'creation' } })
                } else if (isEventMsg) {
                    additionalNodes.push({ tag: 'meta', attrs: { event_type: 'creation' } })
                }

                await relayMessage(resolvedJid, fullMsg.message, {
                    messageId: fullMsg.key.id,
                    useCachedGroupMetadata: options.useCachedGroupMetadata,
                    additionalAttributes,
                    statusJidList: options.statusJidList,
                    additionalNodes
                })

                if (config.emitOwnEvents) {
                    process.nextTick(() => {
                        processingMutex.mutex(() => upsertMessage(fullMsg, 'append'))
                    })
                }

                return fullMsg
            }
        }
    }
}
