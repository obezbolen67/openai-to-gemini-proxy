This is my own proxy for OpenAI to replace GPT models with Google Gemini ones.
# Getting started

## Cloning repo & installing modules
```bash
git clone https://github.com/obezbolen67/openai-to-gemini-proxy.git
cd openai-to-gemini-proxy
npm i
```
## Starting server
```bash
node server.js
```

```
~$ node server.js
Proxy server running on port 3333
```

# Usage
My proxy provides **video**, **image** and **audio** input. For now you can send your media through **direct links** (works well with discord attachments or imgur [images](https://i.imgur.com/Jiny1mJ.jpeg))

For use examples look [Examples Section](docs/README.md#examples)

# Examples (Python)
## Message with image:
```python
from openai import OpenAI

base_url = "http://localhost:3000/v1"

API_KEY = "your_api_key"

model = OpenAI(api_key=API_KEY, base_url=base_url)

response = model.chat.completions.create(
    model="gemini-1.5-flash",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text", 
                    "text": "Describe the image in every detail."
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "https://i.natgeofe.com/n/548467d8-c5f1-4551-9f58-6817a8d2c45e/NationalGeographic_2572187_square.jpg",
                    },
                },
            ],
        }
    ]
)

print(response.choices[0].message.content) # The image is a close-up shot of a cat's face agai...
```
## Message with video:
```python
from openai import OpenAI

base_url = "http://localhost:3000/v1"

API_KEY = "your_api_key"

model = OpenAI(api_key=API_KEY, base_url=base_url)

response = model.chat.completions.create(
    model="gemini-1.5-flash",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text", 
                    "text": "Describe the video in every detail."
                },
                {
                    "type": "video_url",
                    "video_url": {
                        "url": "https://www.dropbox.com/scl/fi/oss8nx5p4ck4u3bcfz24d/2024-06-18-19-33-36.mp4?rlkey=pl751s7kcqgeksdjs4hx6n5um&st=cp5uzd7h&dl=1",
                    },
                },
            ],
        }
    ]
)

print(response.choices[0].message.content) # The video shows a screen recording of a computer running Python code to detect objects in the Minecraft game. The code is in the left half of the screen, and the Minecraft game is in the right half of the screen.
```
## Message with audio:
```python
from openai import OpenAI

base_url = "http://localhost:3000/v1"

API_KEY = "your_api_key"

model = OpenAI(api_key=API_KEY, base_url=base_url)

response = model.chat.completions.create(
    model="gemini-1.5-flash",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text", 
                    "text": "Make subtitles for this audio."
                },
                {
                    "type": "audio_url",
                    "audio_url": {
                        "url": "https://www.eslfast.com/robot/audio/smalltalk/smalltalk0101.mp3",
                    },
                },
            ],
        }
    ]
)

print(response.choices[0].message.content) # 00:00 Hi, how are you doing? \n 00:02 I'm fine, how about yourself? \n 00:04 I'm pretty good. Thanks for asking.
```
# Run Proxy Remotely
If Gemini **blocked** in your region or you want to have a remote server, you can deploy repo on vercel. But be warned that vercel file system is ephemeral (read-only) so **video processing is not available with vercel.**

If you need video processing feature, you may want to fork my repository and use [replit](https://docs.replit.com/replit-workspace/using-git-on-replit/connect-github-to-replit) to run application from it.

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fobezbolen67%2Fopenai-to-gemini-proxy&project-name=my-openai-to-gemini-proxy&repository-name=my-openai-to-gemini-proxy"><img src="https://vercel.com/button" alt="Deploy with Vercel"/></a>

# Support developer
And, if you want to support me, you can buy me a coffe or [become my patron!](https://www.patreon.com/bePatron?u=138740031)

<a href='https://ko-fi.com/W7W8124OZ7' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=3' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>
