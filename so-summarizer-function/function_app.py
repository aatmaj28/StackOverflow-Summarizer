import os
import time
import json
import requests
from bs4 import BeautifulSoup
from openai import AzureOpenAI
import azure.functions as func
from azure.cosmos import CosmosClient, PartitionKey
from datetime import datetime

app = func.FunctionApp()

# Initialize Azure OpenAI client
client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    api_version="2023-05-15",
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
)

# Initialize Cosmos DB client
endpoint = os.getenv("COSMOS_DB_ENDPOINT")
key = os.getenv("COSMOS_DB_KEY")
cosmos_client = CosmosClient(endpoint, key)

# Database and container names
DATABASE_NAME = "SummarizerDB"
CONTAINER_NAME = "QueryHistory"

# Create database and container if not exists
database = cosmos_client.create_database_if_not_exists(id=DATABASE_NAME)
container = database.create_container_if_not_exists(
    id=CONTAINER_NAME, 
    partition_key=PartitionKey(path="/userId")
)

# Track last request time
last_request_time = 0

@app.function_name(name="StoreQueryHistory")
@app.route(route="store-query", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def store_query_history(req: func.HttpRequest) -> func.HttpResponse:
    # Handle CORS preflight
    if req.method == "OPTIONS":
        return func.HttpResponse(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )

    try:
        # Parse incoming JSON
        req_body = req.get_json()
        
        # Required fields
        user_id = req_body.get('userId')
        url = req_body.get('url')
        page_content = req_body.get('pageContent')
        summary = req_body.get('summary')
        queries = req_body.get('queries', [])

        if not all([user_id, url, page_content, summary]):
            return func.HttpResponse(
                "Missing required fields",
                status_code=400,
                headers={"Access-Control-Allow-Origin": "*"}
            )

        # Prepare document for Cosmos DB
        query_history_doc = {
            "id": str(hash(url + user_id)),  # Unique identifier
            "userId": user_id,
            "url": url,
            "pageContent": page_content,
            "summary": summary,
            "queries": queries,
            "timestamp": datetime.utcnow().isoformat()
        }

        # Store in Cosmos DB
        container.create_item(body=query_history_doc)

        return func.HttpResponse(
            "Query history stored successfully",
            status_code=200,
            headers={"Access-Control-Allow-Origin": "*"}
        )

    except Exception as e:
        return func.HttpResponse(
            f"Error storing query history: {str(e)}",
            status_code=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )

@app.function_name(name="RetrieveQueryHistory")
@app.route(route="retrieve-query-history", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def retrieve_query_history(req: func.HttpRequest) -> func.HttpResponse:
    # Handle CORS preflight
    if req.method == "OPTIONS":
        return func.HttpResponse(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )

    try:
        # Get query parameters
        user_id = req.params.get('userId')
        
        if not user_id:
            return func.HttpResponse(
                "User ID is required",
                status_code=400,
                headers={"Access-Control-Allow-Origin": "*"}
            )

        # Query Cosmos DB for user's query history
        query = "SELECT * FROM c WHERE c.userId = @userId ORDER BY c.timestamp DESC"
        params = [{"name": "@userId", "value": user_id}]
        
        query_history = list(container.query_items(
            query=query, 
            parameters=params,
            enable_cross_partition_query=True
        ))

        return func.HttpResponse(
            json.dumps(query_history),
            status_code=200,
            mimetype="application/json",
            headers={"Access-Control-Allow-Origin": "*"}
        )

    except Exception as e:
        return func.HttpResponse(
            f"Error retrieving query history: {str(e)}",
            status_code=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )

@app.function_name(name="SummarizeSO")
@app.route(route="summarize", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def summarize_so(req: func.HttpRequest) -> func.HttpResponse:
    global last_request_time

    # Handle CORS preflight
    if req.method == "OPTIONS":
        return func.HttpResponse(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )

    # Rate limiting (1 request every 20 seconds)
    current_time = time.time()
    if current_time - last_request_time < 20:
        return func.HttpResponse(
            "Please wait 20 seconds between requests",
            status_code=429,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    last_request_time = current_time

    # Get URL parameter
    so_url = req.params.get('url')
    if not so_url:
        return func.HttpResponse(
            "Please pass a Stack Overflow URL",
            status_code=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )

    try:
        # Lightweight scraping
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(so_url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')

        # Extract question
        question_element = soup.find('h1', itemprop='name')
        if not question_element:
            return func.HttpResponse(
                "Could not find question title",
                status_code=400,
                headers={"Access-Control-Allow-Origin": "*"}
            )

        # Extract question details
        question_text = question_element.get_text(strip=True)

        # Find the first answer (highest voted)
        answer_element = soup.select_one('div.s-prose.js-post-body')
        if not answer_element:
            return func.HttpResponse(
                "Could not find answer content",
                status_code=400,
                headers={"Access-Control-Allow-Origin": "*"}
            )

        # Extract full page content for detailed context
        full_page_content = f"Question: {question_text}\n\nAnswer: {answer_element.get_text(strip=True)}"

        # Extract answer text (first 1000 characters)
        answer_text = answer_element.get_text(strip=True)[:1000] + "..."

        # Efficient prompt
        prompt = f"""Provide exactly 2 bullet points summarizing:  Question: {question_text}  Key Answer Excerpt: {answer_text}  Bullet Points:"""

        # Call Azure OpenAI
        result = client.chat.completions.create(
            model="so-summarizer-gpt4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,  # More deterministic
            max_tokens=100    # Strict limit
        )

        summary = result.choices[0].message.content

        # Return response with page content for chatting
        response_data = {
            "summary": summary,
            "pageContent": full_page_content
        }

        return func.HttpResponse(
            json.dumps(response_data),
            mimetype="application/json",
            headers={"Access-Control-Allow-Origin": "*"}
        )

    except Exception as e:
        return func.HttpResponse(
            f"Error: {str(e)}",
            status_code=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )

@app.function_name(name="ChatWithContent")
@app.route(route="chat", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def chat_with_content(req: func.HttpRequest) -> func.HttpResponse:
    # Handle CORS preflight
    if req.method == "OPTIONS":
        return func.HttpResponse(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )

    try:
        # Parse incoming JSON
        req_body = req.get_json()
        url = req_body.get('url', '')
        page_content = req_body.get('pageContent', '')
        user_query = req_body.get('query', '')

        if not page_content or not user_query:
            return func.HttpResponse(
                "Missing page content or query",
                status_code=400,
                headers={"Access-Control-Allow-Origin": "*"}
            )

        # Construct comprehensive prompt
        prompt = f"""Context from StackOverflow URL ({url}):
{page_content}

User Query: {user_query}

Provide a clear, concise, and informative response based on the context. If the query cannot be directly answered from the context, explain why."""

        # Call Azure OpenAI
        result = client.chat.completions.create(
            model="so-summarizer-gpt4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,  # Slightly more creative for Q&A
            max_tokens=300    # Allow more detailed responses
        )

        # Return response
        return func.HttpResponse(
            result.choices[0].message.content,
            mimetype="text/plain",
            headers={"Access-Control-Allow-Origin": "*"}
        )

    except Exception as e:
        return func.HttpResponse(
            f"Error: {str(e)}",
            status_code=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )