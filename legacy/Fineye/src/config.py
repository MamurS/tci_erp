from dotenv import load_dotenv
import os


load_dotenv()

db_user = os.getenv("DB_USER")
db_pass = os.getenv("DB_PASS")
db_host = os.getenv("DB_HOST")
db_port = os.getenv("DB_PORT")
db_name = os.getenv("DB_NAME")

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

gpt_token = os.getenv("GPT_TOKEN")
