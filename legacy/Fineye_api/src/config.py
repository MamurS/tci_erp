from dotenv import load_dotenv
import os


load_dotenv()

db_user = os.getenv("DB_USER")
db_pass = os.getenv("DB_PASS")
db_host = os.getenv("DB_HOST")
db_port = os.getenv("DB_PORT")
db_name = os.getenv("DB_NAME")

db_sub_user = os.getenv("DB_SUB_USER")
db_sub_user_pass = os.getenv("DB_SUB_USER_PASS")

pg_bouncer_host = os.getenv("PG_BOUNCER_HOST")
pg_bouncer_port = os.getenv("PG_BOUNCER_PORT")

redis_pass = os.getenv("REDIS_PASSWORD")
redis_host = os.getenv("REDIS_HOST")
redis_port = os.getenv("REDIS_PORT")

rabbit_user = os.getenv("RABBIT_USER")
rabbit_pass = os.getenv("RABBIT_PASS")
rabbit_host = os.getenv("RABBIT_HOST")
rabbit_port = os.getenv("RABBIT_PORT")
rabbit_port_http = os.getenv("RABBIT_PORT_HTTP")

sftp_host = os.getenv("SFTP_HOST")
sftp_port = os.getenv("SFTP_PORT")
sftp_user = os.getenv("SFTP_USER")
sftp_pass = os.getenv("SFTP_PASS")
sftp_base_path = os.getenv("SFTP_BASE_PATH")
