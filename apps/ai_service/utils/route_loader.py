import logging

logger = logging.getLogger(__name__)

def get_ai_service_route():
    """
    Returns the static route for the AI service.
    (Dynamic YAML parsing was removed as it breaks inside Docker containers
    where the root specs directory is not copied).
    """
    return "/v1", "/sheet-chat"


if __name__ == "__main__":
    import sys
    from pathlib import Path
    sys.path.append(str(Path(__file__).resolve().parent.parent))
    import utils.logger

    logger.info("Testing route_loader directly...")
    prefix, endpoint = get_ai_service_route()
    logger.info(f"Final extracted Prefix: {prefix}")
    logger.info(f"Final extracted Endpoint: {endpoint}")
