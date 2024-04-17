import type { RestAgentModules, RestMultiTenantAgentModules } from '../cliAgent'
import type { Agent } from '@aries-framework/core'
import type { TenantAgent } from '@aries-framework/tenants/build/TenantAgent'

// declare global {
//   namespace Express {
//     interface Request {
//       user: {
//         [x: string]: any
//         agent: Agent<RestAgentModules> | Agent<RestMultiTenantAgentModules> | TenantAgent<RestAgentModules>
//       }
//     }
//   }
// }
type AgentType = Agent<RestAgentModules> | Agent<RestMultiTenantAgentModules> | TenantAgent<RestAgentModules>

interface IAgent {
  agent: AgentType
}

declare global {
  namespace Express {
    interface Request {
      agent: AgentType
    }
  }
}

// declare global {
//   namespace Express {
//     interface Request {
//       user: {
//         [x: string]: any
//         agent: any
//       }
//     }
//   }
// }
