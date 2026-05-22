import json
from typing import Annotated

from dotenv import load_dotenv
from pydantic import Field

from mcp_use import MCPServer

load_dotenv()
server = MCPServer("bookkeeping-tools")


@server.tool()
async def categorize_transaction(
    description: Annotated[str, Field(description="Description of the transaction")],
    vendor: Annotated[str, Field(description="Vendor or merchant name")],
    amount: Annotated[float, Field(description="Transaction amount")],
) -> dict:
    """
    Categorize a financial transaction for SaaS startup
    bookkeeping. Returns category, confidence (0-100),
    and a needs_review flag for ambiguous cases.
    Works without any API key for common vendors.
    """
    # Rule-based classification first (no API needed)
    vendor_lower = vendor.lower()
    desc_lower = description.lower()

    # High-confidence rule-based cases
    cloud_cogs = ["aws", "amazon web services", "gcp", "google cloud", "azure"]
    saas_tools = ["figma", "notion", "slack", "github", "linear", "vercel"]
    ads = ["google ads", "meta ads", "facebook ads", "linkedin ads"]

    if any(v in vendor_lower for v in cloud_cogs):
        # Ambiguous: COGS vs OPEX depends on usage
        return {
            "category": "Needs Review",
            "confidence": 55,
            "reasoning": "Cloud infra is COGS if serving customers, OPEX if internal tooling",
            "needs_review": True,
            "clarifying_question": f"Is the {vendor} charge "
            f"${amount:.0f} for infrastructure serving "
            "customers (COGS) or internal development "
            "tooling (Operating Expense)?",
        }

    if any(v in vendor_lower for v in saas_tools):
        category = "Prepaid Expense" if amount > 500 else "Operating Expense"
        return {"category": category, "confidence": 90, "reasoning": "SaaS tool subscription", "needs_review": False}

    if (
        any(v in vendor_lower for v in ads)
        or any(v in desc_lower for v in ads)
        or "ads" in desc_lower
        or "advertising" in desc_lower
    ):
        return {
            "category": "Sales and Marketing",
            "confidence": 95,
            "reasoning": "Digital advertising spend",
            "needs_review": False,
        }

    contractors = ["deel", "remote.com", "remote", "papaya global", "rippling", "gusto", "mercury payroll"]

    if any(v in vendor_lower for v in contractors):
        return {
            "category": "Contract Labor",
            "confidence": 80,
            "reasoning": "Contractor payroll platform — likely a 1099 contractor payment",
            "needs_review": True,
            "clarifying_question": f"Is the ${amount:.0f} "
            f"Deel payment for a full-time employee "
            "(W2) or an independent contractor (1099)? "
            "This affects tax reporting.",
        }

    # Ambiguous: needs review
    return {
        "category": "Needs Review",
        "confidence": 40,
        "reasoning": "Vendor not recognized — manual classification required",
        "needs_review": True,
        "clarifying_question": f"What is the business purpose of the ${amount:.0f} payment to {vendor}?",
    }


@server.tool()
async def flag_ambiguous_transactions(
    transactions_json: Annotated[str, Field(description="JSON array of transactions")],
) -> str:
    """
    Takes a JSON array of transactions and returns only
    those needing human review. Each flagged item includes
    a specific clarifying question.

    Input format: [{"description": ..., "vendor": ...,
                    "amount": ...}]
    """
    transactions = json.loads(transactions_json)
    flagged = []
    for tx in transactions:
        result = await categorize_transaction(tx["description"], tx["vendor"], tx["amount"])
        if result["needs_review"]:
            flagged.append(
                {
                    "transaction": tx,
                    "category": result["category"],
                    "clarifying_question": result.get("clarifying_question", "Please clarify this transaction."),
                }
            )
    return json.dumps(flagged, indent=2)


if __name__ == "__main__":
    server.run()
