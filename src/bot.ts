import {info, setFailed, warning} from '@actions/core'
import {ConversationChain} from 'langchain/chains'
import {ChatOpenAI} from '@langchain/openai'
import {BufferMemory} from 'langchain/memory'
import {ChatPromptTemplate, MessagesPlaceholder} from '@langchain/core/prompts'
import {ChainValues} from 'langchain/schema'
import {OpenAIOptions, Options} from './options'
import {BotProtocol, Ids} from './bot-interface'

export class Bot implements BotProtocol {
  private readonly model: ChatOpenAI | null = null
  private readonly api: ConversationChain | null = null

  private readonly options: Options

  constructor(options: Options, openaiOptions: OpenAIOptions) {
    this.options = options
    if (process.env.OPENAI_API_KEY) {
      const currentDate = new Date().toISOString().split('T')[0]
      const systemMessage = `${options.systemMessage}
      Knowledge cutoff: ${openaiOptions.tokenLimits.knowledgeCutOff}
      Current date: ${currentDate}
      
      IMPORTANT: Entire response must be in the language with ISO code: ${options.language}
      `
      const chatPrompt = ChatPromptTemplate.fromMessages([
        ['system', systemMessage],
        new MessagesPlaceholder('history'),
        ['human', '{input}']
      ])

      this.model = new ChatOpenAI({
        modelName: openaiOptions.model,
        maxTokens: openaiOptions.tokenLimits.responseTokens,
        openAIApiKey: process.env.OPENAI_API_KEY,
        temperature: this.options.openaiModelTemperature,
        timeout: this.options.openaiTimeoutMS,
        maxRetries: this.options.openaiRetries,
        configuration: {
          baseURL: this.options.apiBaseUrl,
          organization: process.env.OPENAI_API_ORG ?? undefined
        }
      })
      this.api = new ConversationChain({
        memory: new BufferMemory({returnMessages: true, memoryKey: 'history'}),
        prompt: chatPrompt,
        llm: this.model
      })
    } else {
      const err =
        "Unable to initialize the OpenAI API, ensure 'OPENAI_API_KEY' is properly set"
      throw new Error(err)
    }
  }

  chat = async (message: string, ids: Ids): Promise<[string, Ids]> => {
    let res: [string, Ids] = ['', ids]
    try {
      res = await this.chat_(message)
      return res
    } catch (e: unknown) {
      warning(`Failed to chat: ${e}`)
      return res
    }
  }

  private readonly chat_ = async (message: string): Promise<[string, Ids]> => {
    // record timing
    const start = Date.now()
    if (!message) {
      return ['', {}]
    }

    let response: ChainValues | undefined

    if (this.api != null) {
      try {
        response = await this.api.call({input: message})
      } catch (e: unknown) {
        info(`response: ${response}, failed to send message to openai: ${e}`)
      }
      const end = Date.now()
      info(`response: ${JSON.stringify(response)}`)
      info(
        `openai sendMessage (including retries) response time: ${
          end - start
        } ms`
      )
    } else {
      setFailed('The OpenAI API is not initialized')
    }
    let responseText = ''
    if (response != null) {
      responseText = response.response
    } else {
      warning('openai response is null')
    }
    // remove the prefix "with " in the response
    if (responseText.startsWith('with ')) {
      responseText = responseText.substring(5)
    }
    if (this.options.debug) {
      info(`openai responses: ${responseText}`)
    }
    return [responseText, {}]
  }
}
