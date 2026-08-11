from pydantic import BaseModel


class SheetPromptRequest(BaseModel):
    """Request envelope sent by the Google Sheets Apps Script sidebar.

    Attributes:
        prompt: The user's task instruction (required).
        context: Supporting spreadsheet text the model may reference. Defaults
            to an empty string when the caller omits it.
        user: Caller identity for audit logging. Defaults to ``"Anonymous"``
            when not supplied.
    """

    prompt: str
    context: str = ""
    user: str = "Anonymous"
