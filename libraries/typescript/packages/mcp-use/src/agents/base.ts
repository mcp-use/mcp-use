import type { MCPSession } from '../session.js'

export abstract class BaseAgent {
  protected session: MCPSession

  /**
   * @param session MCP session used for tool invocation
   */
  constructor(session: MCPSession) {
    this.session = session
  }

  /**
   * Initialize the agent, including initializing the MCP session
   */
  public abstract initialize(): Promise<void>

  /**
   * Run the agent on a query with a maximum number of steps
   * @param query The user query
   * @param maxSteps Maximum steps allowed (default: 10)
   * @returns Final result of agent execution
   */
  public abstract run(
    query: string,
    maxSteps?: number
  ): Promise<Record<string, any>>

  /**
   * Perform a single step given the query and previous steps
   * @param query The user query or intermediate input
   * @param previousSteps History of steps so far
   * @returns Result of this step
   */
  public abstract step(
    query: string,
    previousSteps?: Array<Record<string, any>>
  ): Promise<Record<string, any>>
}
