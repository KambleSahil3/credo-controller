import type { AgentInfo } from '../types'

import { Agent } from '@aries-framework/core'
import { injectable } from 'tsyringe'

import { Controller, Delete, Get, Route, Tags, Security } from 'tsoa'

@Tags('Agent')
@Route('/agent')
@injectable()
export class AgentController extends Controller {
  private agent: Agent

  public constructor(agent: Agent) {
    super()
    this.agent = agent
  }

  /**
   * Retrieve basic agent information
   */
  @Get('/')
  public async getAgentInfo(): Promise<AgentInfo> {
    // const details = await this.agent.genericRecords.getAll()
    const genericRecord = await this.agent.genericRecords.getAll()
    const recordWithToken = genericRecord.find((record) => record?.content?.token !== undefined)
    const token = recordWithToken?.content.token as string
    return {
      label: this.agent.config.label,
      endpoints: this.agent.config.endpoints,
      isInitialized: this.agent.isInitialized,
      publicDid: undefined,
      // token: details[0].content.token,
      token: token,
    }
  }

  /**
   * Delete wallet
   */
  @Security('apiKey')
  @Delete('/wallet')
  public async deleteWallet() {
    const deleteWallet = await this.agent.wallet.delete()
    return deleteWallet
  }
}
