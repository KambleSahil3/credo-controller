import type { InitConfig } from '@credo-ts/core'
import type { WalletConfig } from '@credo-ts/core/build/types'
import type { IndyVdrPoolConfig } from '@credo-ts/indy-vdr'

import { PolygonDidRegistrar, PolygonDidResolver, PolygonModule } from '@ayanworks/credo-polygon-w3c-module'
import {
  AnonCredsCredentialFormatService,
  AnonCredsModule,
  AnonCredsProofFormatService,
  LegacyIndyCredentialFormatService,
  LegacyIndyProofFormatService,
  V1CredentialProtocol,
  V1ProofProtocol,
} from '@credo-ts/anoncreds'
import { AskarModule, AskarMultiWalletDatabaseScheme } from '@credo-ts/askar'
import {
  AutoAcceptCredential,
  AutoAcceptProof,
  DidsModule,
  ProofsModule,
  V2ProofProtocol,
  CredentialsModule,
  V2CredentialProtocol,
  ConnectionsModule,
  W3cCredentialsModule,
  KeyDidRegistrar,
  KeyDidResolver,
  CacheModule,
  InMemoryLruCache,
  WebDidResolver,
  HttpOutboundTransport,
  WsOutboundTransport,
  LogLevel,
  Agent,
  JsonLdCredentialFormatService,
  DifPresentationExchangeProofFormatService,
} from '@credo-ts/core'
import {
  IndyVdrAnonCredsRegistry,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
  IndyVdrIndyDidRegistrar,
} from '@credo-ts/indy-vdr'
import { agentDependencies, HttpInboundTransport, WsInboundTransport } from '@credo-ts/node'
import { QuestionAnswerModule } from '@credo-ts/question-answer'
import { TenantsModule } from '@credo-ts/tenants'
import { anoncreds } from '@hyperledger/anoncreds-nodejs'
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs'
import axios from 'axios'
import { randomBytes } from 'crypto'
import { readFile } from 'fs/promises'
import jwt from 'jsonwebtoken'

import { IndicioTransactionAuthorAgreement, Network, NetworkName } from './enums/enum'
import { setupServer } from './server'
import { TsLogger } from './utils/logger'
import {
  BCOVRIN_TEST_GENESIS,
  DID_CONTRACT_ADDRESS,
  FILE_SERVER_TOKEN,
  RPC_URL,
  SCHEMA_MANAGER_CONTRACT_ADDRESS,
  SERVER_URL,
} from './utils/util'

export type Transports = 'ws' | 'http'
export type InboundTransport = {
  transport: Transports
  port: number
}

const inboundTransportMapping = {
  http: HttpInboundTransport,
  ws: WsInboundTransport,
} as const

const outboundTransportMapping = {
  http: HttpOutboundTransport,
  ws: WsOutboundTransport,
} as const

interface indyLedger {
  genesisTransactions: string
  indyNamespace: string
}
export interface AriesRestConfig {
  label: string
  walletConfig: WalletConfig
  indyLedger: indyLedger[]
  publicDidSeed?: string
  endpoints?: string[]
  autoAcceptConnections?: boolean
  autoAcceptCredentials?: AutoAcceptCredential
  autoAcceptProofs?: AutoAcceptProof
  logLevel?: LogLevel
  inboundTransports?: InboundTransport[]
  outboundTransports?: Transports[]
  autoAcceptMediationRequests?: boolean
  connectionImageUrl?: string
  tenancy?: boolean
  webhookUrl?: string
  adminPort: number
  didRegistryContractAddress?: string
  schemaManagerContractAddress?: string
  rpcUrl?: string
  fileServerUrl?: string
  fileServerToken?: string
  walletScheme?: string
}

export async function readRestConfig(path: string) {
  const configString = await readFile(path, { encoding: 'utf-8' })
  const config = JSON.parse(configString)

  return config
}

export type RestMultiTenantAgentModules = Awaited<ReturnType<typeof getWithTenantModules>>

export type RestAgentModules = Awaited<ReturnType<typeof getModules>>

const getModules = (
  networkConfig: [IndyVdrPoolConfig, ...IndyVdrPoolConfig[]],
  didRegistryContractAddress: string,
  fileServerToken: string,
  fileServerUrl: string,
  rpcUrl: string,
  schemaManagerContractAddress: string,
  autoAcceptConnections: boolean,
  autoAcceptCredentials: string,
  autoAcceptProofs: string,
  walletScheme: string
) => {
  const legacyIndyCredentialFormat = new LegacyIndyCredentialFormatService()
  const legacyIndyProofFormat = new LegacyIndyProofFormatService()
  const jsonLdCredentialFormatService = new JsonLdCredentialFormatService()
  const anonCredsCredentialFormatService = new AnonCredsCredentialFormatService()
  const anonCredsProofFormatService = new AnonCredsProofFormatService()
  const presentationExchangeProofFormatService = new DifPresentationExchangeProofFormatService()
  return {
    askar: new AskarModule({
      ariesAskar,
      multiWalletDatabaseScheme:
        (walletScheme as AskarMultiWalletDatabaseScheme) || AskarMultiWalletDatabaseScheme.ProfilePerWallet,
    }),

    indyVdr: new IndyVdrModule({
      indyVdr,
      networks: networkConfig,
    }),

    dids: new DidsModule({
      registrars: [new IndyVdrIndyDidRegistrar(), new KeyDidRegistrar(), new PolygonDidRegistrar()],
      resolvers: [new IndyVdrIndyDidResolver(), new KeyDidResolver(), new WebDidResolver(), new PolygonDidResolver()],
    }),

    anoncreds: new AnonCredsModule({
      registries: [new IndyVdrAnonCredsRegistry()],
      anoncreds,
    }),

    connections: new ConnectionsModule({
      autoAcceptConnections: autoAcceptConnections || true,
    }),
    proofs: new ProofsModule({
      autoAcceptProofs: (autoAcceptProofs as AutoAcceptProof) || AutoAcceptProof.ContentApproved,
      proofProtocols: [
        new V1ProofProtocol({
          indyProofFormat: legacyIndyProofFormat,
        }),
        new V2ProofProtocol({
          proofFormats: [legacyIndyProofFormat, anonCredsProofFormatService, presentationExchangeProofFormatService],
        }),
      ],
    }),
    credentials: new CredentialsModule({
      autoAcceptCredentials: (autoAcceptCredentials as AutoAcceptCredential) || AutoAcceptCredential.Always,
      credentialProtocols: [
        new V1CredentialProtocol({
          indyCredentialFormat: legacyIndyCredentialFormat,
        }),
        new V2CredentialProtocol({
          credentialFormats: [
            legacyIndyCredentialFormat,
            jsonLdCredentialFormatService,
            anonCredsCredentialFormatService,
          ],
        }),
      ],
    }),
    w3cCredentials: new W3cCredentialsModule(),
    cache: new CacheModule({
      cache: new InMemoryLruCache({ limit: Infinity }),
    }),

    questionAnswer: new QuestionAnswerModule(),
    polygon: new PolygonModule({
      didContractAddress: (didRegistryContractAddress as string)
        ? (didRegistryContractAddress as string)
        : (DID_CONTRACT_ADDRESS as string),
      schemaManagerContractAddress:
        (schemaManagerContractAddress as string) || (SCHEMA_MANAGER_CONTRACT_ADDRESS as string),
      fileServerToken: (fileServerToken as string) ? (fileServerToken as string) : (FILE_SERVER_TOKEN as string),
      rpcUrl: (rpcUrl as string) ? (rpcUrl as string) : (RPC_URL as string),
      serverUrl: (fileServerUrl as string) ? (fileServerUrl as string) : (SERVER_URL as string),
    }),
  }
}

const getWithTenantModules = (
  networkConfig: [IndyVdrPoolConfig, ...IndyVdrPoolConfig[]],
  didRegistryContractAddress: string,
  fileServerToken: string,
  fileServerUrl: string,
  rpcUrl: string,
  schemaManagerContractAddress: string,
  autoAcceptConnections: boolean,
  autoAcceptCredentials: string,
  autoAcceptProofs: string,
  walletScheme: string
) => {
  const modules = getModules(
    networkConfig,
    didRegistryContractAddress,
    fileServerToken,
    fileServerUrl,
    rpcUrl,
    schemaManagerContractAddress,
    autoAcceptConnections,
    autoAcceptCredentials,
    autoAcceptProofs,
    walletScheme
  )
  return {
    tenants: new TenantsModule<typeof modules>({
      sessionAcquireTimeout: Infinity,
      sessionLimit: Infinity,
    }),
    ...modules,
  }
}

async function generateSecretKey(length: number = 32): Promise<string> {
  // Asynchronously generate a buffer containing random values
  const buffer: Buffer = await new Promise((resolve, reject) => {
    randomBytes(length, (error, buf) => {
      if (error) {
        reject(error)
      } else {
        resolve(buf)
      }
    })
  })

  // Convert the buffer to a hexadecimal string
  const secretKey: string = buffer.toString('hex')

  return secretKey
}

export async function runRestAgent(restConfig: AriesRestConfig) {
  const {
    logLevel,
    inboundTransports = [],
    outboundTransports = [],
    webhookUrl,
    adminPort,
    didRegistryContractAddress,
    fileServerToken,
    fileServerUrl,
    rpcUrl,
    schemaManagerContractAddress,
    walletConfig,
    autoAcceptConnections,
    autoAcceptCredentials,
    autoAcceptProofs,
    walletScheme,
    ...afjConfig
  } = restConfig

  const logger = new TsLogger(logLevel ?? LogLevel.error)

  const agentConfig: InitConfig = {
    walletConfig: {
      id: walletConfig.id,
      key: walletConfig.key,
      storage: walletConfig.storage,
    },
    ...afjConfig,
    logger,
    autoUpdateStorageOnStartup: true,
    // As backup is only supported for sqlite storage
    // we need to manually take backup of the storage before updating the storage
    backupBeforeStorageUpdate: false,
  }

  async function fetchLedgerData(ledgerConfig: {
    genesisTransactions: string
    indyNamespace: string
  }): Promise<IndyVdrPoolConfig> {
    const urlPattern = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w-./?%&=]*)?$/

    if (!urlPattern.test(ledgerConfig.genesisTransactions)) {
      throw new Error('Not a valid URL')
    }

    const genesisTransactions = await axios.get(ledgerConfig.genesisTransactions)

    const networkConfig: IndyVdrPoolConfig = {
      genesisTransactions: genesisTransactions.data,
      indyNamespace: ledgerConfig.indyNamespace,
      isProduction: false,
      connectOnStartup: true,
    }

    if (ledgerConfig.indyNamespace.includes(NetworkName.Indicio)) {
      if (
        ledgerConfig.indyNamespace === (Network.Indicio_Testnet as string) ||
        ledgerConfig.indyNamespace === (Network.Indicio_Mainnet as string)
      ) {
        networkConfig.transactionAuthorAgreement = {
          version: IndicioTransactionAuthorAgreement.Indicio_Testnet_Mainnet_Version,
          acceptanceMechanism: IndicioTransactionAuthorAgreement.Indicio_Acceptance_Mechanism,
        }
      } else {
        networkConfig.transactionAuthorAgreement = {
          version: IndicioTransactionAuthorAgreement.Indicio_Demonet_Version,
          acceptanceMechanism: IndicioTransactionAuthorAgreement.Indicio_Acceptance_Mechanism,
        }
      }
    }

    return networkConfig
  }

  let networkConfig: [IndyVdrPoolConfig, ...IndyVdrPoolConfig[]]

  const parseIndyLedger = afjConfig?.indyLedger
  if (parseIndyLedger.length !== 0) {
    networkConfig = [
      await fetchLedgerData(parseIndyLedger[0]),
      ...(await Promise.all(parseIndyLedger.slice(1).map(fetchLedgerData))),
    ]
  } else {
    networkConfig = [
      {
        genesisTransactions: BCOVRIN_TEST_GENESIS,
        indyNamespace: Network.Bcovrin_Testnet,
        isProduction: false,
        connectOnStartup: true,
      },
    ]
  }

  const tenantModule = await getWithTenantModules(
    networkConfig,
    didRegistryContractAddress || '',
    fileServerToken || '',
    fileServerUrl || '',
    rpcUrl || '',
    schemaManagerContractAddress || '',
    autoAcceptConnections || true,
    autoAcceptCredentials || '',
    autoAcceptProofs || '',
    walletScheme || ''
  )
  const modules = getModules(
    networkConfig,
    didRegistryContractAddress || '',
    fileServerToken || '',
    fileServerUrl || '',
    rpcUrl || '',
    schemaManagerContractAddress || '',
    autoAcceptConnections || true,
    autoAcceptCredentials || '',
    autoAcceptProofs || '',
    walletScheme || ''
  )
  const agent = new Agent({
    config: agentConfig,
    modules: {
      ...(afjConfig.tenancy
        ? {
            ...tenantModule,
          }
        : {}),
      ...modules,
    },
    dependencies: agentDependencies,
  })

  // Register outbound transports
  for (const outboundTransport of outboundTransports) {
    const OutboundTransport = outboundTransportMapping[outboundTransport]
    agent.registerOutboundTransport(new OutboundTransport())
  }

  // Register inbound transports
  for (const inboundTransport of inboundTransports) {
    const InboundTransport = inboundTransportMapping[inboundTransport.transport]
    agent.registerInboundTransport(new InboundTransport({ port: inboundTransport.port }))
  }

  await agent.initialize()

  let token: string = ''
  const genericRecord = await agent.genericRecords.getAll()

  const recordsWithToken = genericRecord.some((record: { content: { token: any } }) => record?.content?.token)
  if (!genericRecord.length || !recordsWithToken) {
    // Call the async function
    const secretKeyInfo: string = await generateSecretKey()
    // Check if the secretKey already exist in the genericRecords

    // if already exist - then don't generate the secret key again
    // Check if the JWT token already available in genericRecords - if yes, and also don't generate the JWT token
    // instead use the existin JWT token
    // if JWT token is not found, create/generate a new token and save in genericRecords
    // next time, the same token should be used - instead of creating a new token on every restart event of the agent

    // if already exist - then don't generate the secret key again
    // Check if the JWT token already available in genericRecords - if yes, and also don't generate the JWT token
    // instead use the existin JWT token
    // if JWT token is not found, create/generate a new token and save in genericRecords
    // next time, the same token should be used - instead of creating a new token on every restart event of the agent
    token = jwt.sign({ agentInfo: 'agentInfo' }, secretKeyInfo)
    await agent.genericRecords.save({
      content: {
        secretKey: secretKeyInfo,
        token,
      },
    })
  } else {
    const recordWithToken = genericRecord.find(
      (record: { content: { token: undefined } }) => record?.content?.token !== undefined
    )
    token = recordWithToken?.content.token as string
  }

  const app = await setupServer(
    agent,
    {
      webhookUrl,
      port: adminPort,
    },
    token
  )

  logger.info(`*** API Token: ${token}`)

  app.listen(adminPort, () => {
    logger.info(`Successfully started server on port ${adminPort}`)
  })
}
