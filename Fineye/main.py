import traceback
import asyncio
import os
import platform
import tempfile
import time
from uuid import uuid4

from rpc.app import RPC
from service_logger.app import Log


REQUEST_CLEANUP_INTERVAL = 3
request_count = 0

def cleanup_temp_files(max_age_minutes=10):
    """Очистка временных файлов с учетом ОС"""
    try:
        if platform.system() == 'Linux':
            # Для Linux/MacOS
            temp_dir = '/tmp'
            if os.path.exists(temp_dir):
                os.system(
                    f'find {temp_dir} -type f -mmin +{max_age_minutes} '
                    '-delete 2>/dev/null || true'
                )
        else:
            # Для Windows
            temp_dir = tempfile.gettempdir()
            for filename in os.listdir(temp_dir):
                filepath = os.path.join(temp_dir, filename)
                try:
                    if os.path.isfile(filepath):
                        file_age = (time.time() - os.path.getmtime(filepath)) / 60
                        if file_age > max_age_minutes:
                            os.unlink(filepath)
                except: continue  # noqa: E701, E722
    except Exception as e:
        print(f"Cleanup error: {str(e)}")

async def main():
    global request_count
    
    await Log.add_log(
        log_type="info",
        request_uuid=str(uuid4()),
        message="starting a Fineye Pro instance.",
    )
    while True:
        request_count += 1
        try:
            await RPC.consume()
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            print(log_content)
        finally:
            if request_count % REQUEST_CLEANUP_INTERVAL == 0:
                cleanup_temp_files()
                request_count = 0



if __name__ == "__main__":
    asyncio.run(main())
