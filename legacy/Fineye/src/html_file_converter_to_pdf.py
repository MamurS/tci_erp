import io
import os
import platform
import subprocess
import time

import pdfkit
from PyPDF2 import PdfWriter, PdfReader
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

class HTMLFileConverterToPDF:
    def __init__(
        self, output_file_path: str, temp_dir: str, is_group: bool,
        html_file_names: list, path_wkhtmltopdf=None
    ):
        self.temp_dir = temp_dir
        self.html_file_names = html_file_names
        self.path_wkhtmltopdf = path_wkhtmltopdf
        self.output_file_path = output_file_path
        self.is_group = is_group
    
    def _cleanup_processes(self) -> None:
        """Безопасное завершение всех wkhtmltopdf и kaleido процессов с обработкой ошибок"""
        try:
            if platform.system() == 'Windows':
                self._kill_windows_process('wkhtmltopdf.exe')
                self._kill_windows_process('kaleido.exe')
            else:
                self._kill_unix_process('wkhtmltopdf')
                self._kill_unix_process('kaleido/exec')
                self._clear_system_cache()
        except Exception as e:
            print(f"Ошибка при очистке процессов: {str(e)}")
    
    def _kill_unix_process(self, process_name: str) -> None:
        """Завершение процесса в Unix-системах"""
        try:
            # Более безопасный вариант через subprocess
            subprocess.run(
                ['pkill', '-f', process_name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5
            )
        except subprocess.TimeoutExpired:
            print(f"Таймаут при завершении {process_name}")
    
    def _kill_windows_process(self, process_name: str) -> None:
        """Завершение процесса в Windows"""
        try:
            subprocess.run(
                ['taskkill', '/f', '/im', process_name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                shell=True
            )
        except subprocess.TimeoutExpired:
            print(f"Таймаут при завершении {process_name}")
    
    def _clear_system_cache(self) -> None:
        """Очистка системного кэша (только для Unix)"""
        try:
            subprocess.run(
                ['sync'],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            with open('/proc/sys/vm/drop_caches', 'w') as f:
                f.write('3\n')
        except Exception as e:
            print(f"Ошибка при очистке кэша: {str(e)}")
    
    @staticmethod
    def paste_image(image_path: str, pdf_path: str, image_type: str = "speedometer"):
        # Создайте новый PDF с изображением
        packet = io.BytesIO()
        can = canvas.Canvas(packet, pagesize=letter)
        if image_type == "speedometer":
            width = 200
            height = 200
            can.drawImage(image_path, 55, 55, width, height)  # Координаты и размер grade_speedometer
        
        elif image_type == "profitability_dynamic":
            width = 500
            height = 300
            can.drawImage(image_path, 55, 405, width, height)  # Координаты и размер dynamic_graph
        
        elif image_type == "turnover_dynamic":
            width = 500
            height = 300
            can.drawImage(image_path, 55, 125, width, height)  # Координаты и размер dynamic_graph
            
        elif image_type == "logo":
            width = 3*19
            height = 3*10
            can.drawImage(image_path, 20, 780, width, height)  # TODO (!!!) Укажите координаты и размер logo
        
        can.save()
        
        # Переместите "пакет" в начало
        packet.seek(0)
        new_pdf = PdfReader(packet)
        
        # Считайте существующий PDF
        with open(pdf_path, "rb") as file:
            existing_pdf = PdfReader(file)
            output = PdfWriter()
            
            # Добавьте страницу из нового PDF в существующий
            page = existing_pdf.pages[0]
            page.merge_page(new_pdf.pages[0])
            output.add_page(page)
            
            # Сохраните измененный PDF
            with open(pdf_path, "wb") as outputStream:
                output.write(outputStream)
                output.close()
                packet.close()
    
    @staticmethod
    def __merge_pdfs(paths: list, output: str):
        pdf_writer = PdfWriter()
        
        for path in paths:
            pdf_reader = PdfReader(path)
            for page in range(len(pdf_reader.pages)):
                # Добавляем каждую страницу в результирующий файл
                pdf_writer.add_page(pdf_reader.pages[page])
        
        # Записываем объединенный PDF
        with open(output, 'wb') as out:
            pdf_writer.write(out)
            pdf_writer.close()
    
    def convert_html_to_pdf(self) -> None:
        path_wkhtmltopdf = self.path_wkhtmltopdf
        config = pdfkit.configuration(wkhtmltopdf=path_wkhtmltopdf)
        
        # NEW: базовые опции для уменьшения утечек памяти
        base_options = {
            'quiet': '',  # NEW: уменьшает нагрузку на логгирование
            'disable-javascript': '',  # NEW: отключает JS для стабильности
            'margin-top': '0mm',
            'margin-right': '0mm',
            'margin-bottom': '0mm',
            'margin-left': '0mm',
        }
        
        list_files_to_merge = []
        for idx, html_file_name in enumerate(self.html_file_names):
            path_to_new_pdf_page = os.path.join(self.temp_dir, f'P{idx + 1}.pdf')
            
            # NEW: комбинируем базовые опции с пользовательскими
            options = {**base_options, 'no-images': False}
            
            try:
                pdfkit.from_file(
                    os.path.join(self.temp_dir, html_file_name),
                    path_to_new_pdf_page,
                    configuration=config,
                    options=options,
                )
            except Exception as e:
                print(f"PDF conversion error: {str(e)}")
                self._cleanup_processes()
                continue
            
            time.sleep(1)
            
            
            if html_file_name == "output_1.html":
                HTMLFileConverterToPDF.paste_image(
                    image_path=os.path.join(os.path.abspath(__file__), self.temp_dir, "grade_speedometer.png"),
                    pdf_path=os.path.join(os.path.abspath(__file__), path_to_new_pdf_page),
                    image_type="speedometer"
                )
            
            if html_file_name == f"output_{'9' if self.is_group else '8'}.html":
                HTMLFileConverterToPDF.paste_image(
                    image_path=os.path.join(os.path.abspath(__file__), self.temp_dir, "profitability_dynamic_graph.png"),
                    pdf_path=os.path.join(os.path.abspath(__file__), path_to_new_pdf_page),
                    image_type="profitability_dynamic"
                )
                HTMLFileConverterToPDF.paste_image(
                    image_path=os.path.join(os.path.abspath(__file__), self.temp_dir, "turnover_dynamic_graph.png"),
                    pdf_path=os.path.join(os.path.abspath(__file__), path_to_new_pdf_page),
                    image_type="turnover_dynamic"
                )
            
            list_files_to_merge.append(path_to_new_pdf_page)
        
        time.sleep(2)
        
        HTMLFileConverterToPDF.__merge_pdfs(
            paths=list_files_to_merge,
            output=self.output_file_path,
        )
        
        self._cleanup_processes()
