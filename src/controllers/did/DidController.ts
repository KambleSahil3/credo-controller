import type { DidCreate, DidResolutionResultProps } from '../types'
import { DidCreateResult, DidOperationStateActionBase, Hasher, JsonTransformer, Key, KeyType, TypedArrayEncoder } from '@aries-framework/core'
import { Agent } from '@aries-framework/core'
import { Body, Controller, Example, Get, Path, Post, Res, Route, Tags, TsoaResponse } from 'tsoa'
import { injectable } from 'tsyringe'
import { IndySdkIndyDidCreateOptions, IndySdkIndyDidRegistrar, IndySdkIndyDidResolver, IndySdkModuleConfig } from '@aries-framework/indy-sdk'
import { Did, DidRecordExample } from '../examples'
import * as IndySdk from 'indy-sdk';
import axios from 'axios';

@Tags('Dids')
@Route('/dids')
@injectable()
export class DidController extends Controller {
  private agent: Agent

  public constructor(agent: Agent) {
    super()
    this.agent = agent
  }

  /**
   * Resolves did and returns did resolution result
   * @param did Decentralized Identifier
   * @returns DidResolutionResult
   */
  @Example<DidResolutionResultProps>(DidRecordExample)
  @Get('/:did')
  public async getDidRecordByDid(@Path('did') did: Did) {
    const resolveResult = await this.agent.dids.resolve(did);
    const importDid = await this.agent.dids.import({
      did,
      overwrite: true
    });
    if (!resolveResult.didDocument) {
      this.setStatus(500)
      return { importDid }
    }

    return { ...resolveResult, didDocument: resolveResult.didDocument.toJSON() }
  }

  /**
   * Did nym registration
   * @body DidCreateOptions
   * @returns DidResolutionResult
   */
  // @Example<DidResolutionResultProps>(DidRecordExample)

  @Post('/write')
  public async writeDid(
    @Body() data: DidCreate,
    @Res() internalServerError: TsoaResponse<500, { message: string }>) {
    try {

      data.method = data.method ? data.method : 'bcovrin';
      if ('bcovrin' === data.method) {
        let body = {
          role: 'ENDORSER',
          alias: 'Alias',
          seed: data.seed
        };

        return await axios
          .post('http://test.bcovrin.vonx.io/register', body)
          .then(async (res) => {
            if (res.data) {
              await this.agent.dids.import({
                did: `did:indy:bcovrin:${res.data.did}`,
                overwrite: true,
                privateKeys: [
                  {
                    keyType: KeyType.Ed25519,
                    privateKey: TypedArrayEncoder.fromString(data.seed),
                  },
                ],
              })
              return { did: `did:indy:bcovrin:${res.data.did}` };
            }
          })
      } else if ('indicio' === data.method) {

        const key = await this.agent.wallet.createKey({
          privateKey: TypedArrayEncoder.fromString(data.seed),
          keyType: KeyType.Ed25519
        });

        const buffer = TypedArrayEncoder.fromBase58(key.publicKeyBase58);
        const did = TypedArrayEncoder.toBase58(buffer.slice(0, 16));

        let body = {
          network: 'testnet',
          did,
          verkey: TypedArrayEncoder.toBase58(buffer)
        };

        return await axios
          .post('https://selfserve.indiciotech.io/nym', body)
          .then(async (res) => {
            if (200 === res.data.statusCode) {

              await this.agent.dids.import({
                did: `did:indy:indicio:${body.did}`,
                overwrite: true,
                privateKeys: [
                  {
                    keyType: KeyType.Ed25519,
                    privateKey: TypedArrayEncoder.fromString(data.seed)
                  },
                ],
              })
              return { did: `did:indy:indicio:${did}` };
            }
          })
      }
    }
    catch (error) {
      return internalServerError(500, { message: `something went wrong: ${error}` })

    }
  }

  @Get('/')
  public async getDids() {
    const createdDids = await this.agent.dids.getCreatedDids()
    return createdDids;
  }
}