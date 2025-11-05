"""
Structured Output Example - City Research with Playwright

This example demonstrates intelligent structured output by researching Padova, Italy.
"""

import asyncio

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from mcp_use import MCPAgent, MCPClient


class CityInfo(BaseModel):
    """Comprehensive information about a city"""

    name: str = Field(description="Official name of the city")
    country: str = Field(description="Country where the city is located")
    region: str = Field(description="Region or state within the country")
    population: int = Field(description="Current population count")
    area_km2: float = Field(description="Area in square kilometers")
    foundation_date: str = Field(description="When the city was founded (approximate year or period)")
    mayor: str = Field(description="Current mayor or city leader")
    famous_landmarks: list[str] = Field(description="List of famous landmarks, monuments, or attractions")
    universities: list[str] = Field(description="List of major universities or educational institutions")
    economy_sectors: list[str] = Field(description="Main economic sectors or industries")
    sister_cities: list[str] = Field(description="Twin cities or sister cities partnerships")
    historical_significance: str = Field(description="Brief description of historical importance")
    climate_type: str | None = Field(description="Type of climate (e.g., Mediterranean, Continental)", default=None)
    elevation_meters: int | None = Field(description="Elevation above sea level in meters", default=None)


async def main():
    """Research Padova using intelligent structured output."""
    load_dotenv()

    config = {
        "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"], "env": {"DISPLAY": ":1"}}}
    }

    client = MCPClient(config=config)
    llm = ChatOpenAI(model="gpt-5")
    agent = MCPAgent(llm=llm, client=client, max_steps=50)

    result: CityInfo = await agent.run(
        """
        Research comprehensive information about the city of Padova (also known as Padua) in Italy.

        Visit multiple reliable sources like Wikipedia, official city websites, tourism sites,
        and university websites to gather detailed information including demographics, history,
        governance, education, economy, landmarks, and international relationships.
        """,
        output_schema=CityInfo,
        max_steps=50,
    )

    print(f"Name: {result.name}")
    print(f"Country: {result.country}")
    print(f"Region: {result.region}")
    print(f"Population: {result.population:,}")
    print(f"Area: {result.area_km2} km²")
    print(f"Foundation: {result.foundation_date}")
    print(f"Mayor: {result.mayor}")
    print(f"Universities: {', '.join(result.universities)}")
    print(f"Economy: {', '.join(result.economy_sectors)}")
    print(f"Landmarks: {', '.join(result.famous_landmarks)}")
    print(f"Sister Cities: {', '.join(result.sister_cities) if result.sister_cities else 'None'}")
    print(f"Historical Significance: {result.historical_significance}")
    if result.climate_type:
        print(f"Climate: {result.climate_type}")
    if result.elevation_meters:
        print(f"Elevation: {result.elevation_meters} meters")


if __name__ == "__main__":
    asyncio.run(main())
