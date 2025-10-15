/**
 * Structured Output Example - City Research with Playwright
 *
 * This example demonstrates intelligent structured output by researching Padova, Italy.
 * The agent becomes schema-aware and will intelligently retry to gather missing
 * information until all required fields can be populated.
 */

import { ChatOpenAI } from '@langchain/openai'
import { config } from 'dotenv'
import { z } from 'zod'
import { MCPAgent, MCPClient } from '../../index.js'

// Load environment variables from .env file
config()

// Define the structured output schema using Zod
const CityInfoSchema = z.object({
  name: z.string().describe('Official name of the city'),
  country: z.string().describe('Country where the city is located'),
  region: z.string().describe('Region or state within the country'),
  population: z.number().describe('Current population count'),
  area_km2: z.number().describe('Area in square kilometers'),
  foundation_date: z.string().describe('When the city was founded (approximate year or period)'),
  mayor: z.string().describe('Current mayor or city leader'),
  famous_landmarks: z.array(z.string()).describe('List of famous landmarks, monuments, or attractions'),
  universities: z.array(z.string()).describe('List of major universities or educational institutions'),
  economy_sectors: z.array(z.string()).describe('Main economic sectors or industries'),
  sister_cities: z.array(z.string()).describe('Twin cities or sister cities partnerships'),
  historical_significance: z.string().describe('Brief description of historical importance'),
  climate_type: z.string().nullable().describe('Type of climate (e.g., Mediterranean, Continental)'),
  elevation_meters: z.number().nullable().describe('Elevation above sea level in meters'),
})

type CityInfo = z.infer<typeof CityInfoSchema>

async function main() {
  const mcpConfig = {
    mcpServers: {
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        env: {
          DISPLAY: ':1',
        },
      },
    },
  }

  const client = new MCPClient(mcpConfig)
  const llm = new ChatOpenAI({ model: 'gpt-4o' })
  const agent = new MCPAgent({ llm, client, maxSteps: 50, memoryEnabled: true })

  try {
    // Use structured output with intelligent retry
    // The agent will:
    // 1. Know exactly what information it needs to collect
    // 2. Attempt structured output at finish points
    // 3. Continue execution if required information is missing
    // 4. Only finish when all required fields can be populated
    const eventStream = agent.streamEvents(
      `
      Research comprehensive information about the city of Padova (also known as Padua) in Italy.
      
      Visit multiple reliable sources like Wikipedia, official city websites, tourism sites,
      and university websites to gather detailed information including demographics, history,
      governance, education, economy, landmarks, and international relationships.
      `,
      50, // maxSteps
      true, // manageConnector
      [], // externalHistory
      CityInfoSchema, // outputSchema - this enables structured output
    )

    let result: CityInfo | null = null

    for await (const event of eventStream) {
      // Look for structured output in the final result
      if (event.event === 'on_chain_end' && event.data?.output) {
        try {
          // Try to parse the output as structured data
          const parsed = CityInfoSchema.parse(event.data.output)
          result = parsed
          break
        } catch (e) {
          // If parsing fails, continue streaming
          console.log('Waiting for structured output...')
        }
      }
    }
    if (!result) {
      throw new Error('Failed to obtain structured output')
    }

    // Now you have strongly-typed, validated data!
    console.log(`Name: ${result.name}`)
    console.log(`Country: ${result.country}`)
    console.log(`Region: ${result.region}`)
    console.log(`Population: ${result.population.toLocaleString()}`)
    console.log(`Area: ${result.area_km2} km²`)
    console.log(`Foundation: ${result.foundation_date}`)
    console.log(`Mayor: ${result.mayor}`)
    console.log(`Universities: ${result.universities.join(', ')}`)
    console.log(`Economy: ${result.economy_sectors.join(', ')}`)
    console.log(`Landmarks: ${result.famous_landmarks.join(', ')}`)
    console.log(`Sister Cities: ${result.sister_cities.length > 0 ? result.sister_cities.join(', ') : 'None'}`)
    console.log(`Historical Significance: ${result.historical_significance}`)

    if (result.climate_type) {
      console.log(`Climate: ${result.climate_type}`)
    }

    if (result.elevation_meters !== null) {
      console.log(`Elevation: ${result.elevation_meters} meters`)
    }
  }
  catch (error) {
    console.error('Error:', error)
  }
  finally {
    await agent.close()
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})

main().catch(console.error)
