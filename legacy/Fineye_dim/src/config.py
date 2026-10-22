from dotenv import load_dotenv
import os


load_dotenv()

db_user = os.getenv("DB_USER")
db_pass = os.getenv("DB_PASS")
db_host = os.getenv("DB_HOST")
db_port = os.getenv("DB_PORT")
db_name = os.getenv("DB_NAME")

pg_bouncer_host = os.getenv("PG_BOUNCER_HOST")
pg_bouncer_port = os.getenv("PG_BOUNCER_PORT")

rabbit_user = os.getenv("RABBIT_USER")
rabbit_pass = os.getenv("RABBIT_PASS")
rabbit_host = os.getenv("RABBIT_HOST")
rabbit_port = os.getenv("RABBIT_PORT")
rabbit_port_http = os.getenv("RABBIT_PORT_HTTP")

# API credentials
checko_token = os.getenv("CHECKO_TOKEN")
fns_token = os.getenv("FNS_TOKEN")
