import type { RestAgentModules } from '../../cliAgent'
import type { BitStringCredential } from '../types'
import type {
  CredentialExchangeRecordProps,
  CredentialProtocolVersionType,
  CredentialStatus,
  Routing,
} from '@credo-ts/core'

import { CredentialState, Agent, W3cCredentialService, Key, KeyType, CredentialRole } from '@credo-ts/core'
import * as fs from 'fs'
import { injectable } from 'tsyringe'
import { promisify } from 'util'
import * as zlib from 'zlib'

import ErrorHandlingService from '../../errorHandlingService'
import { CredentialExchangeRecordExample, RecordId } from '../examples'
import { OutOfBandController } from '../outofband/OutOfBandController'
import {
  AcceptCredentialRequestOptions,
  ProposeCredentialOptions,
  AcceptCredentialProposalOptions,
  CredentialOfferOptions,
  CreateOfferOptions,
  AcceptCredential,
  CreateOfferOobOptions,
  ThreadId,
} from '../types'

import { Body, Controller, Get, Path, Post, Route, Tags, Example, Query, Security } from 'tsoa'

@Tags('Credentials')
@Security('apiKey')
@Route('/credentials')
@injectable()
export class CredentialController extends Controller {
  private agent: Agent<RestAgentModules>
  private outOfBandController: OutOfBandController

  public constructor(agent: Agent<RestAgentModules>, outOfBandController: OutOfBandController) {
    super()
    this.agent = agent
    this.outOfBandController = outOfBandController
  }

  /**
   * Retrieve all credential exchange records
   *
   * @returns CredentialExchangeRecord[]
   */
  @Example<CredentialExchangeRecordProps[]>([CredentialExchangeRecordExample])
  @Get('/')
  public async getAllCredentials(
    @Query('threadId') threadId?: ThreadId,
    @Query('parentThreadId') parentThreadId?: ThreadId,
    @Query('connectionId') connectionId?: RecordId,
    @Query('state') state?: CredentialState,
    @Query('role') role?: CredentialRole
  ) {
    try {
      const credentials = await this.agent.credentials.findAllByQuery({
        connectionId,
        threadId,
        state,
        parentThreadId,
        role,
      })

      return credentials.map((c) => c.toJSON())
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  // TODO: Fix W3cCredentialRecordExample from example
  // @Example<W3cCredentialRecordOptions[]>([W3cCredentialRecordExample])
  @Get('/w3c')
  public async getAllW3c() {
    try {
      const w3cCredentialService = await this.agent.dependencyManager.resolve(W3cCredentialService)
      const w3cCredentialRecords = await w3cCredentialService.getAllCredentialRecords(this.agent.context)
      return w3cCredentialRecords
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  // TODO: Fix W3cCredentialRecordExample from example
  // @Example<W3cCredentialRecordOptions[]>([W3cCredentialRecordExample])
  @Get('/w3c/:id')
  public async getW3cById(@Path('id') id: string) {
    try {
      const w3cCredentialService = await this.agent.dependencyManager.resolve(W3cCredentialService)
      const w3cRecord = await w3cCredentialService.getCredentialRecordById(this.agent.context, id)
      return w3cRecord
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Retrieve credential exchange record by credential record id
   *
   * @param credentialRecordId
   * @returns CredentialExchangeRecord
   */
  @Example<CredentialExchangeRecordProps>(CredentialExchangeRecordExample)
  @Get('/:credentialRecordId')
  public async getCredentialById(@Path('credentialRecordId') credentialRecordId: RecordId) {
    try {
      const credential = await this.agent.credentials.getById(credentialRecordId)
      return credential.toJSON()
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Initiate a new credential exchange as holder by sending a propose credential message
   * to the connection with a specified connection id.
   *
   * @param options
   * @returns CredentialExchangeRecord
   */
  @Example<CredentialExchangeRecordProps>(CredentialExchangeRecordExample)
  @Post('/propose-credential')
  public async proposeCredential(@Body() proposeCredentialOptions: ProposeCredentialOptions) {
    try {
      const credential = await this.agent.credentials.proposeCredential(proposeCredentialOptions)
      return credential
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a credential proposal as issuer by sending an accept proposal message
   * to the connection associated with the credential exchange record.
   *
   * @param credentialRecordId credential identifier
   * @param options
   * @returns CredentialExchangeRecord
   */
  @Example<CredentialExchangeRecordProps>(CredentialExchangeRecordExample)
  @Post('/accept-proposal')
  public async acceptProposal(@Body() acceptCredentialProposal: AcceptCredentialProposalOptions) {
    try {
      const credential = await this.agent.credentials.acceptProposal(acceptCredentialProposal)

      return credential
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Initiate a new credential exchange as issuer by creating a credential offer
   * without specifying a connection id
   *
   * @param options
   * @returns AgentMessage, CredentialExchangeRecord
   */
  @Example<CredentialExchangeRecordProps>(CredentialExchangeRecordExample)
  @Post('/create-offer')
  public async createOffer(@Body() createOfferOptions: CreateOfferOptions) {
    try {
      if (createOfferOptions.credentialFormats.jsonld) {
        if (createOfferOptions.isRevocable) {
          const credentialStatus = await this.getCredentialStatus(createOfferOptions)
          createOfferOptions.credentialFormats.jsonld.credential.credentialStatus = credentialStatus
        }
      }
      const offer = await this.agent.credentials.offerCredential(createOfferOptions)
      return offer
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  private async getCredentialStatus(createOfferOptions: CreateOfferOptions) {
    try {
      const bitStringStatusListURL = fs.readFileSync('config.json', 'utf-8')
      const configJson = JSON.parse(bitStringStatusListURL)

      if (!configJson.bitStringStatusListURL) {
        throw new Error('Please provide valid bitStringStatusList server URL')
      }

      const bitStringStatusListCredential = await fetch(configJson.bitStringStatusListURL, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!bitStringStatusListCredential.ok) {
        throw new Error(`HTTP error! Status: ${bitStringStatusListCredential.status}`)
      }

      const bitStringCredential = (await bitStringStatusListCredential.json()) as BitStringCredential
      const encodedBitString = bitStringCredential.credential.credentialSubject.encodedList
      const gunzip = promisify(zlib.gunzip)

      const compressedBuffer = Buffer.from(encodedBitString, 'base64')
      const decompressedBuffer = await gunzip(compressedBuffer)
      const decodedBitString = decompressedBuffer.toString('binary')
      const index = decodedBitString.indexOf('0')

      const credentialStatus = {
        id: `${configJson.bitStringStatusListURL}#${index}`,
        type: 'BitstringStatusListEntry',
        statusPurpose: createOfferOptions.statusPurpose,
        statusListIndex: index.toString(),
        statusListCredential: configJson.bitStringStatusListURL,
      } as unknown as CredentialStatus

      return credentialStatus
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  @Post('/create-offer-oob')
  public async createOfferOob(@Body() outOfBandOption: CreateOfferOobOptions) {
    try {
      let routing: Routing
      const linkSecretIds = await this.agent.modules.anoncreds.getLinkSecretIds()
      if (linkSecretIds.length === 0) {
        await this.agent.modules.anoncreds.createLinkSecret()
      }
      if (outOfBandOption?.recipientKey) {
        routing = {
          endpoints: this.agent.config.endpoints,
          routingKeys: [],
          recipientKey: Key.fromPublicKeyBase58(outOfBandOption.recipientKey, KeyType.Ed25519),
          mediatorId: undefined,
        }
      } else {
        routing = await this.agent.mediationRecipient.getRouting({})
      }
      const offerOob = await this.agent.credentials.createOffer({
        protocolVersion: outOfBandOption.protocolVersion as CredentialProtocolVersionType<[]>,
        credentialFormats: outOfBandOption.credentialFormats,
        autoAcceptCredential: outOfBandOption.autoAcceptCredential,
        comment: outOfBandOption.comment,
      })

      const credentialMessage = offerOob.message
      const outOfBandRecord = await this.agent.oob.createInvitation({
        label: outOfBandOption.label,
        messages: [credentialMessage],
        autoAcceptConnection: true,
        imageUrl: outOfBandOption?.imageUrl,
        routing,
      })
      return {
        invitationUrl: outOfBandRecord.outOfBandInvitation.toUrl({
          domain: this.agent.config.endpoints[0],
        }),
        invitation: outOfBandRecord.outOfBandInvitation.toJSON({
          useDidSovPrefixWhereAllowed: this.agent.config.useDidSovPrefixWhereAllowed,
        }),
        outOfBandRecord: outOfBandRecord.toJSON(),
        recipientKey: outOfBandOption?.recipientKey ? {} : { recipientKey: routing.recipientKey.publicKeyBase58 },
      }
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a credential offer as holder by sending an accept offer message
   * to the connection associated with the credential exchange record.
   *
   * @param credentialRecordId credential identifier
   * @param options
   * @returns CredentialExchangeRecord
   */
  @Example<CredentialExchangeRecordProps>(CredentialExchangeRecordExample)
  @Post('/accept-offer')
  public async acceptOffer(@Body() acceptCredentialOfferOptions: CredentialOfferOptions) {
    try {
      const linkSecretIds = await this.agent.modules.anoncreds.getLinkSecretIds()
      if (linkSecretIds.length === 0) {
        await this.agent.modules.anoncreds.createLinkSecret()
      }
      const acceptOffer = await this.agent.credentials.acceptOffer(acceptCredentialOfferOptions)
      return acceptOffer
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a credential request as issuer by sending an accept request message
   * to the connection associated with the credential exchange record.
   *
   * @param credentialRecordId credential identifier
   * @param options
   * @returns CredentialExchangeRecord
   */
  @Example<CredentialExchangeRecordProps>(CredentialExchangeRecordExample)
  @Post('/accept-request')
  public async acceptRequest(@Body() acceptCredentialRequestOptions: AcceptCredentialRequestOptions) {
    try {
      const credential = await this.agent.credentials.acceptRequest(acceptCredentialRequestOptions)
      return credential
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }

  /**
   * Accept a credential as holder by sending an accept credential message
   * to the connection associated with the credential exchange record.
   *
   * @param options
   * @returns CredentialExchangeRecord
   */
  @Example<CredentialExchangeRecordProps>(CredentialExchangeRecordExample)
  @Post('/accept-credential')
  public async acceptCredential(@Body() acceptCredential: AcceptCredential) {
    try {
      const credential = await this.agent.credentials.acceptCredential(acceptCredential)
      return credential
    } catch (error) {
      throw ErrorHandlingService.handle(error)
    }
  }
}
