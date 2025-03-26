import azure.functions as func
import requests
from bs4 import BeautifulSoup
import openai
import os

app = func.FunctionApp()


# http://localhost:7071/api/summarize?url=[https://stackoverflow.com/questions/21690009/how-to-download-and-use-python-on-ubuntu] 

@app.function_name(name="SummarizeSO")
@app.route(route="summarize", auth_level=func.AuthLevel.ANONYMOUS)
def summarize_so(req: func.HttpRequest) -> func.HttpResponse:
    # Get URL from query params
    so_url = req.params.get('url')
    if not so_url:
        return func.HttpResponse("Please pass a URL", status_code=400)

    try:
        # Scrape Stack Overflow
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(so_url, headers=headers)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        question = soup.find('div', class_='question').get_text(strip=True)
        answer = soup.find('div', class_='answer').get_text(strip=True)

        # Configure OpenAI
        openai.api_key = os.environ["AZURE_OPENAI_KEY"]
        openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]
        openai.api_type = "azure"
        
        # Generate summary
        prompt = f"Summarize this Stack Overflow thread:\n\nQ: {question}\nA: {answer}"
        response = openai.ChatCompletion.create(
            engine="so-summarizer-gpt4",
            messages=[{"role": "user", "content": prompt}]
        )

        return func.HttpResponse(response.choices[0].message.content)

    except Exception as e:
        return func.HttpResponse(f"Error: {str(e)}", status_code=500)