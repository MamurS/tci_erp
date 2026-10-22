import os
import re
import tempfile
import time
import traceback
from typing import Any, Dict, Optional

from sqlalchemy import insert

from src.models import FileStore
from src.connection_manager import SyncSFTPStorage, get_sync_session
from service_logger.app import Log

from .translate import Translate
from .combined_financials_calculator import CombinedFinancialCalculator
from .comment_generator import CommentGenerator
from .comment_improvment_with_ai import CommentImprover
from .credit_limit_calculator import CreditLimitCalculator
from .data_linker import VisualizationDataAggregator
from .data_preparer import DataPreparer
from .grade_calculator import GradeCalculator
from .html_file_converter_to_pdf import HTMLFileConverterToPDF
from .ratios_calculator import CalculatorRatiosAndDynamic
from .report_file_creator_from_html import ReportFileCreator
from .text_description_generator import TextDescriptionGenerator
from .config import gpt_token


class Fineye:
    def __init__(
        self,
        identifier: str,
        country: str,
        currency: str,
        language: str,
        data: Dict[str, Any],
        with_court_cases: bool,
        count_not_active: Optional[int],
        request_uuid: str,
        file_uuid: str,
        queue_name: Optional[str],
    ) -> None:
        self.identifier = identifier
        self.country = country
        self.currency = currency
        self.language = language
        self.data = data
        self.with_court_cases = with_court_cases
        self.count_not_active = count_not_active
        self.request_uuid = request_uuid
        self.file_uuid = file_uuid
        self.queue_name = queue_name
    
    async def start(self) -> None:
        try:
            prepared_data = DataPreparer(
                country=self.country,
                currency=self.currency,
                data=self.data,
                request_uuid=self.request_uuid,
            ).prepare_data()
            await Log.add_log(
                log_type="info",
                request_uuid=self.request_uuid,
                message="Данные по запросу преобразованы.",
            )
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при подготовке данных к старой структуре:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        # print(prepared_data)
        try:
            combined = CombinedFinancialCalculator(dict_with_data=prepared_data).get_data_with_combined()
            await Log.add_log(
                log_type="info",
                request_uuid=self.request_uuid,
                message="Рассчитана комбинированная отчетность.",
            )
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при расчете консолидированных финансовых показателей:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        # print(f"{combined=}")
        try:
            ratios = CalculatorRatiosAndDynamic(
                dict_with_data=combined,
                target_company_registration_identifier=self.identifier,
            ).get_data_with_ratios_and_dynamics()
            await Log.add_log(
                log_type="info",
                request_uuid=self.request_uuid,
                message="Рассчитаны финансовые показатели и динамика.",
            )
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при расчете коэффициентов и динамики:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        # print(f"{ratios=}")
        try:
            grade = GradeCalculator(
                dict_with_data=ratios,
                target_company_registration_identifier=self.identifier,
            ).get_data_with_grade()
            await Log.add_log(
                log_type="info",
                request_uuid=self.request_uuid,
                message="Рассчитан рейтинг.",
            )
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при расчете рейтинга:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        # print(f"{grade=}")
        try:
            limit = await CreditLimitCalculator(
                dict_with_data=grade,
                request_uuid=self.request_uuid,
            ).get_data_with_credit_limite()
            await Log.add_log(
                log_type="info",
                request_uuid=self.request_uuid,
                message="Рассчитан кредитный лимит.",
            )
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при расчете кредитного лимита:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        # print(f"{limit=}")
        try:
            data_with_grade_description = TextDescriptionGenerator(dict_with_data=limit).get_data_with_grade_description()
            await Log.add_log(
                log_type="info",
                request_uuid=self.request_uuid,
                message="Сгенерирована расшифровка рейтинга.",
            )
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при генерации текста обоснования рейтинга:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        # print(f"{data_with_grade_description=}")
        try:
            reports_with_paragraphs = CommentGenerator(
                dict_with_data=data_with_grade_description,
                target_company_registration_identifier=self.identifier,
                # activity_mapping=activity_mapping.ACTIVITY_MAPPING
            ).get_comments()
            # print(reports_with_paragraphs)
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при генерации комментариев:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message="Сгенерированы комментарии к отчету.",
        )
        # print(f"{reports_with_paragraphs=}")
        
        # Улучшение комментариев с помощью ChatGPT
        # __________________________________________________________________________________________________________________
        try:
            time.sleep(1.5)
            reports_with_improved_paragraphs = CommentImprover(
                dict_with_data=reports_with_paragraphs,
                target_company_registration_identifier=self.identifier,
                language=self.language,
                token=gpt_token,
            ).get_improve_comments()
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при исправлении комментариев с помощью LLM:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        # print(reports_with_improved_paragraphs)
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message="Исправлены комментарии с помощью LLM.",
        )
        try:
            aggregate_data = VisualizationDataAggregator(
                dict_with_data=reports_with_improved_paragraphs,
                target_company_registration_identifier=self.identifier,
                count_not_active=self.count_not_active,
                language=self.language,
            ).get_data_for_visual()
            # print(f"{aggregate_data=}")
            await Log.add_log(
                log_type="info",
                request_uuid=self.request_uuid,
                message="Завершена агрегация данных для визуальной части отчета.",
            )
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при агрегации данных для визуальной части отчета:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        
        try:
            aggregate_data = await Translate(
                dict_with_data=aggregate_data,
                language=self.language,
            ).translate_and_aggregate_data()
            # -------------------------------------------------------------
            # import json
            # with open('aggregate_data.json', 'w', encoding='utf-8') as json_file:
            #     json.dump(aggregate_data, json_file, ensure_ascii=False)
            # -------------------------------------------------------------
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при переводе отчета:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
            )
            return
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message="Завершен перевод отчета.",
        )
        
        # Открываем tmp-папку для создания отчета, все промежуточные файлы удалятся после отработки
        # __________________________________________________________________________________________________________________
        with tempfile.TemporaryDirectory(dir=os.path.abspath(os.path.join("src", 'tmp')), ignore_cleanup_errors=True) as temp_dir_path:
            try:
                try:
                    report = ReportFileCreator(
                        dict_with_data=aggregate_data,
                        target_company_registration_identifier=self.identifier,
                        with_court_cases=self.with_court_cases,
                        dir_path=temp_dir_path,
                    )
                    limit, grade = report.create_report_file()
                except Exception as e:
                    error_message = str(e)
                    formatted_traceback = traceback.format_exc()
                    log_content = f"{error_message}\n{formatted_traceback}"
                    
                    await Log.add_log(
                        log_type="error",
                        request_uuid=self.request_uuid,
                        message=f"Ошибка при создании временных файлов для отчета:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
                    )
                    return
                await Log.add_log(
                    log_type="info",
                    request_uuid=self.request_uuid,
                    message="Завершено создание временных файлов для отчета.",
                )
                # Считывание файлов из tmp-папки для конвертации
                # __________________________________________________________________________________________________________________
                
                def get_html_files(temp_path):
                    dir_contents = os.listdir(temp_path)
                    temp_html_files = []
                    html_pattern = r'.*\.html$'
                    
                    for file_path in dir_contents:
                        if re.match(html_pattern, file_path):
                            temp_html_files.append(file_path)
                    
                    return temp_html_files
                
                def sort_html_by_numbers(f_name):
                    return int(f_name.split('_')[1].split('.')[0])
                
                try:
                    dir_html_files = get_html_files(temp_dir_path)
                    sorted_html_paths = sorted(dir_html_files, key=sort_html_by_numbers)
                    
                    # Конвертация HTML в PDF
                    # __________________________________________________________________________________________________________________
                    
                    time.sleep(3)
                    path_wkhtmltopdf = r'/usr/local/bin/wkhtmltopdf'  # Замените на ваш путь. КОНТЕЙНЕР: r'/usr/local/bin/wkhtmltopdf' LOCAL: r'C:\\Program Files\wkhtmltopdf\bin\wkhtmltopdf.exe'
                    file_name = report.file_name
                    
                    HTMLFileConverterToPDF(output_file_path=os.path.join(temp_dir_path, file_name),
                                            temp_dir=os.path.join(os.path.dirname(__file__), temp_dir_path),
                                            html_file_names=sorted_html_paths, is_group=aggregate_data["aggregated_data_for_the_report"].get("is_group"),
                                            path_wkhtmltopdf=path_wkhtmltopdf).convert_html_to_pdf()
                except Exception as e:
                    error_message = str(e)
                    formatted_traceback = traceback.format_exc()
                    log_content = f"{error_message}\n{formatted_traceback}"
                    
                    await Log.add_log(
                        log_type="error",
                        request_uuid=self.request_uuid,
                        message=f"Ошибка при конвертации html-файлов в pdf-файлы отчета:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
                    )
                    return
                await Log.add_log(
                    log_type="info",
                    request_uuid=self.request_uuid,
                    message="Отчет создан.",
                )
                time.sleep(2.9)
                try:
                    with SyncSFTPStorage() as storage:
                        sftp_path = storage.save_file(
                            source_path=os.path.join(temp_dir_path, file_name),
                            original_filename=file_name,
                            file_uuid=self.file_uuid
                        )
                    with get_sync_session() as session:
                        stmt = (
                            insert(FileStore)
                            .values(
                                {
                                    "file_path": sftp_path,
                                    "file_name": file_name,
                                    "uuid": self.file_uuid,
                                }
                            )
                        )
                        session.execute(stmt)
                        session.commit()
                
                except Exception as e:
                    error_message = str(e)
                    formatted_traceback = traceback.format_exc()
                    log_content = f"{error_message}\n{formatted_traceback}"
                    
                    await Log.add_log(
                        log_type="error",
                        request_uuid=self.request_uuid,
                        message=f"Ошибка при отправке файла отчета в хранилище:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
                    )
                    return
                await Log.add_log(
                    log_type="info",
                    request_uuid=self.request_uuid,
                    message="Файл сжат и отправлен в хранилище.",
                )
            finally:
                for filename in os.listdir(temp_dir_path):
                    file_path = os.path.join(temp_dir_path, filename)
                    try:
                        if os.path.isfile(file_path):
                            os.unlink(file_path)
                    except Exception as e:
                        print(f"Ошибка удаления временных файлов {file_path}: {e}")
        # __________________________________________________________________________
