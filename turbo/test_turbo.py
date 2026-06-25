# -*- coding: utf-8 -*-
# Testes da lógica determinística do turbo.py (sem rede): classificação, range e catálogo.
#   cd turbo && python -m unittest -v
import os
import tempfile
import unittest

import turbo


class TestClassificar(unittest.TestCase):
    def test_ok_quando_tem_accordion(self):
        self.assertEqual(turbo.classificar(200, '<div class="accordion-item">x</div>'), "ok")

    def test_sessao_por_302(self):
        self.assertEqual(turbo.classificar(302, '<div class="accordion-item">x</div>'), "sessao")

    def test_sessao_por_login(self):
        self.assertEqual(turbo.classificar(200, '<input name="T_Login">'), "sessao")

    def test_inexistente(self):
        self.assertEqual(turbo.classificar(200, "Erro: Pedido inexistente!"), "inexistente")

    def test_bloqueio_so_sem_accordion(self):
        self.assertEqual(turbo.classificar(200, "java.sql.Exception systables"), "bloqueio")

    def test_bloqueio_nao_dispara_em_pagina_valida(self):
        # erro de informix no corpo MAS com accordion-item => é página válida (não é bloqueio)
        html = '<div class="accordion-item"></div> systables'
        self.assertEqual(turbo.classificar(200, html), "ok")

    def test_sem_dados(self):
        self.assertEqual(turbo.classificar(200, "<html>nada</html>"), "sem_dados")


class TestParseRange(unittest.TestCase):
    def test_basico(self):
        self.assertEqual(turbo.parse_range("4145-100000"), (4145, 100000))

    def test_aplica_floor(self):
        self.assertEqual(turbo.parse_range("10-5000"), (4145, 5000))

    def test_espacos(self):
        self.assertEqual(turbo.parse_range(" 4145 - 100000 "), (4145, 100000))

    def test_invalido(self):
        with self.assertRaises(ValueError):
            turbo.parse_range("4145")

    def test_fim_menor(self):
        with self.assertRaises(ValueError):
            turbo.parse_range("100000-4145")


class TestCatalog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cat = turbo.Catalog(os.path.join(self.tmp, "c.sqlite"))

    def test_done_set_so_terminais(self):
        self.cat.mark(1, "gravado")
        self.cat.mark(2, "sem_dados")
        self.cat.mark(3, "falhou")          # falhou NÃO é terminal -> retoma no próximo passe
        self.assertEqual(self.cat.done_set(), {1, 2})

    def test_mark_many_e_stats(self):
        self.cat.mark_many([10, 11, 12], "gravado")
        self.assertEqual(self.cat.stats().get("gravado"), 3)

    def test_upsert_atualiza_status(self):
        self.cat.mark(5, "falhou")
        self.cat.mark(5, "gravado")
        self.assertEqual(self.cat.done_set(), {5})


if __name__ == "__main__":
    unittest.main()
