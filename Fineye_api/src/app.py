import aiofiles

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
# from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware

from .lifespan import lifespan

from .routes.amqp_connection_routes import router as amqp_connection_router
from .routes.dim_routes import router as dim_router
from .routes.fineye_routes import router as fineye_router
from .routes.statistic_routes import router as statistic_router


app = FastAPI(
    title="API Fineye",
    lifespan=lifespan,
)

# Middlewares
# Подключение CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Подключение GZipMiddleware
app.add_middleware(
    GZipMiddleware,
    minimum_size=500,
    compresslevel=6
)

# Подключение HTTPSRedirectMiddleware
# # TODO в продовой версии нужно обязательно использовать
# app.add_middleware(
#     HTTPSRedirectMiddleware
# )
# ___________


@app.get("/", response_class=HTMLResponse)
async def index():
    async with aiofiles.open("./templates/index.html", "r", encoding="utf-8") as file:
        content = await file.read()
    return content
# ___________

app.include_router(amqp_connection_router)
app.include_router(dim_router)
app.include_router(fineye_router)
app.include_router(statistic_router)
# ___________
