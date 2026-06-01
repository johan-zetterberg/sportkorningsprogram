import { saveJudge, deleteJudge } from '../../services/adminService.js';
import { showAlert } from '../../ui/components.js';
import { normalizeJudgeRoles } from './adminJudgeRoleUtils.js';

export function renderAdminJudgesList(judges) {
    const list = document.getElementById('adminJudgesList');
    if (!list) return;

    list.innerHTML = judges.map(judge => {
        const roles = (judge.roles || []).map(role => {
            if (role.discipline === 'dressage') return `Huvuddomare / Gästdomare - ${role.position || 'Domare'}`;
            if (role.discipline === 'precision') return 'Precisionsdomare';
            if (role.discipline === 'marathon') return 'Maratondomare';
            if (role.discipline === 'overjudge') return 'Överdomare';
            return role.discipline;
        }).join(', ');

        return `
        <div class="flex justify-between items-center p-3 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded shadow-sm clickable-judge cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" data-judge-id="${judge.id}">
            <div>
                <div class="font-bold text-gray-800 dark:text-gray-200">${judge.name}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">${roles || 'Inga roller'}</div>
                <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">${(judge.classes || []).join(', ')}</div>
            </div>
            <button class="delete-judge-btn text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" data-id="${judge.id}" title="Ta bort domare">
                Ta bort
            </button>
        </div>
        `;
    }).join('');
}

export function setupJudgeForm({ competitionId, getJudges }) {
    const form = document.getElementById('adminJudgeForm');
    if (!form) return;
    const roleContainer = document.getElementById('judge-roles-container');
    const addRoleBtn = document.getElementById('add-judge-role-btn');
    let currentRoles = [];

    const render = () => {
        roleContainer.innerHTML = currentRoles.map((role, index) => `
        <div class="flex justify-between bg-white dark:bg-gray-800 p-2 border dark:border-gray-600 rounded mb-1 dark:text-gray-200">
                <span>${role.discipline} ${role.position || ''}</span>
                <button type="button" class="remove-judge-role-btn text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300" data-idx="${index}">&times;</button>
            </div>`).join('');

        roleContainer.querySelectorAll('.remove-judge-role-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentRoles.splice(parseInt(btn.dataset.idx), 1);
                render();
            });
        });
    };

    addRoleBtn.addEventListener('click', () => {
        const discipline = document.getElementById('new-role-discipline').value;
        const position = document.getElementById('new-role-position').value;
        currentRoles.push({ discipline, position: discipline === 'dressage' ? position : '' });
        render();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = document.getElementById('judgeName').value;
        const id = document.getElementById('judgeId').value || name.replace(/\s+/g, '-').toLowerCase();
        await saveJudge(competitionId, id, { id, name, roles: normalizeJudgeRoles(currentRoles) });
        showAlert('Domare sparad.');
        form.reset();
        document.getElementById('judgeId').value = '';
        currentRoles = [];
        render();
    });

    const newJudgeBtn = document.getElementById('newJudgeBtn');
    if (newJudgeBtn) {
        newJudgeBtn.addEventListener('click', () => {
            form.reset();
            document.getElementById('judgeId').value = '';
            currentRoles = [];
            render();
        });
    }

    const list = document.getElementById('adminJudgesList');
    if (list) list.onclick = async (event) => {
        const deleteBtn = event.target.closest('.delete-judge-btn');
        if (deleteBtn) {
            event.preventDefault();
            event.stopPropagation();
            const judgeId = deleteBtn.dataset.id;
            if (judgeId && confirm('Är du säker på att du vill ta bort denna domare?')) {
                await deleteJudge(competitionId, judgeId);
                showAlert('Domaren har tagits bort.');
            }
            return;
        }

        const row = event.target.closest('.clickable-judge');
        if (row) {
            const judge = getJudges().find(item => item.id === row.dataset.judgeId);
            if (judge) {
                document.getElementById('judgeId').value = judge.id;
                document.getElementById('judgeName').value = judge.name;
                currentRoles = (judge.roles || []).map(role => ({ ...role }));
                render();
            }
        }
    };
}
