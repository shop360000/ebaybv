// Khởi tạo biến lưu trữ dữ liệu email
let emailData = [];
// Phân trang
let currentPage = 1;
let pageSize = 50; // hiển thị 50 dòng theo yêu cầu

// Khởi tạo khi trang đã tải xong
$(document).ready(function() {
    // Tải dữ liệu ban đầu
    loadEmailData();
    
    // Xử lý sự kiện thêm email (không kiểm tra hợp lệ, chỉ cần không rỗng)
    $('#addEmailBtn').click(function() {
        const email = $('#emailInput').val().trim();
        if (email !== '') {
            const $btn = $(this);
            const originalText = $btn.text();
            $btn.prop('disabled', true).text('Đang thêm...');
            
            addEmail(email)
                .always(function() {
                    // Reset nút sau khi hoàn tất
                    $btn.prop('disabled', false).text(originalText);
                });
            
            $('#emailInput').val('');
        }
    });
    
    
    $('#fileInput').change(function(e) {
        const file = e.target.files[0];
        // Hiển thị tên file đã chọn
        const $fileNameDisplay = $('#fileNameDisplay');
        if (file) {
            // Trình duyệt không cho lấy full path thật (bảo mật),
            // nhưng e.target.value sẽ hiển thị dạng "C:\\fakepath\\ten_file.ext" nếu có.
            const shownPath = e.target.value || file.name;
            $fileNameDisplay.text(shownPath).attr('title', shownPath);
            const reader = new FileReader();
            reader.onload = function(e) {
                const content = (e.target.result || '').trim();
                // B1: ưu tiên tách theo xuống dòng (mỗi dòng là một mục)
                let emails = content
                    .replace(/\r/g, '\n')
                    .split(/\n+/)
                    .map(s => s.trim())
                    .filter(Boolean);

                // B2: nếu chỉ còn 1 dòng dài (ví dụ danh sách ngăn bởi dấu phẩy/chấm phẩy), fallback tách theo , ;
                if (emails.length <= 1 && content.length > 0) {
                    emails = content
                        .split(/[;,]+/)
                        .map(s => s.trim())
                        .filter(Boolean);
                }

                // B3: nếu vẫn rỗng nhưng có nội dung, đưa toàn bộ vào một mục
                if (emails.length === 0 && content.length > 0) {
                    emails = [content];
                }

                importEmails(emails);
                // Cập nhật trạng thái nhập và cho phép nhập lại cùng một file
                $('#importStatus').text(`Đang nhập ${emails.length} dòng...`);
                e.target.value = '';
            };
            reader.onerror = function() {
                alert('Không đọc được file. Vui lòng thử lại.');
            };
            reader.readAsText(file);
        }
        else {
            $fileNameDisplay.text('');
            $fileNameDisplay.removeAttr('title');
        }
    });
    
    // Xử lý sự kiện xuất email
    $('#exportEmailsBtn').click(function() {
        const status = $('#statusFilter').val();
        exportEmails(status);
    });
    
    // Sử dụng ủy quyền sự kiện cho các nút được tạo động (đã bỏ xem/sửa theo yêu cầu)
    $('#email-list-body').on('click', '.delete-btn', function() {
        const id = $(this).data('id');
        deleteEmail(id);
    });

    // Copy cookie theo từng dòng
    $('#email-list-body').on('click', '.copy-cookie-btn', function() {
        const id = $(this).data('id');
        copyCookie(id);
    });

    // Phân trang: điều khiển
    $('#prevPage').on('click', function() {
        if (currentPage > 1) {
            currentPage--;
            renderEmailList();
        }
    });
    $('#nextPage').on('click', function() {
        const totalPages = getTotalPages();
        if (currentPage < totalPages) {
            currentPage++;
            renderEmailList();
        }
    });
    $('#pageSizeSelect').on('change', function() {
        pageSize = parseInt($(this).val(), 10) || 50;
        currentPage = 1; // về trang đầu khi đổi page size
        renderEmailList();
    });
});

// Hàm kiểm tra email hợp lệ
function isValidEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

// Tổng số trang
function getTotalPages() {
    return Math.max(1, Math.ceil(emailData.length / pageSize));
}

// Cập nhật hiển thị thanh phân trang
function updatePaginationBar() {
    const totalPages = getTotalPages();
    $('#pageInfo').text(`${currentPage}/${totalPages}`);
    $('#prevPage').prop('disabled', currentPage <= 1);
    $('#nextPage').prop('disabled', currentPage >= totalPages);
    $('#pageSizeSelect').val(String(pageSize));
}

// Cố định chiều cao khu vực danh sách theo số dòng để có thanh kéo mượt
function adjustListHeight() {
    const $list = $('.email-list');
    const $header = $list.find('.email-list-header');
    const $firstRow = $list.find('.email-row').first();
    const headerH = $header.outerHeight() || 0;
    const rowH = $firstRow.outerHeight() || 34; // fallback chiều cao dòng
    const target = Math.round(headerH + rowH * pageSize);
    $list.css({
        'max-height': `${target}px`,
        'overflow-y': 'auto'
    });
}
// Hàm tải dữ liệu email từ API
function loadEmailData() {
    fetch('/api/emails')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            // Sắp xếp dữ liệu theo ID giảm dần (mới nhất lên đầu)
            emailData = data.sort((a, b) => b.id - a.id);
            renderEmailList();
        })
        .catch(error => {
            console.error('Lỗi khi tải dữ liệu:', error);
            // Hiển thị lỗi trên UI
            $('#email-list-body').html('<div class="email-row" style="justify-content: center; color: red;">Không thể tải dữ liệu từ server.</div>');
        });
}

// Hàm hiển thị danh sách email vào các div
function renderEmailList() {
    const listBody = $('#email-list-body');
    listBody.empty(); // Xóa nội dung cũ

    if (emailData.length === 0) {
        listBody.html('<div class="email-row" style="justify-content: center;">Không có dữ liệu</div>');
        updateCounters(); // Vẫn cập nhật counter về 0
        updatePaginationBar();
        return;
    }

    // Tính toán phân trang
    const totalPages = getTotalPages();
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageItems = emailData.slice(start, end);

    pageItems.forEach(email => {
        const statusInfo = getStatusInfo(email.status);
        const row = `
            <div class="email-row">
                <div class="email-col email-col-id" data-label="ID">${email.id}</div>
                <div class="email-col email-col-email" data-label="Email">${email.email}</div>
                <div class="email-col email-col-proxy" data-label="Proxy">${email.proxy || '-'}</div>
                <div class="email-col email-col-cookie" data-label="Cookie">
                    <button class="btn btn-sm btn-info copy-cookie-btn" data-id="${email.id}">Copy</button>
                </div>
                <div class="email-col email-col-status" data-label="Trạng thái">
                    <span class="status-inline"><span class="status-dot ${statusInfo.dot}"></span><span>${statusInfo.text}</span></span>
                </div>
                <div class="email-col email-col-created" data-label="Ngày tạo">${email.created_at}</div>
                <div class="email-col email-col-actions" data-label="Thao tác">
                    <button class="btn btn-sm btn-danger delete-btn" data-id="${email.id}">Xóa</button>
                </div>
            </div>
        `;
        listBody.append(row);
    });

    // Cập nhật số đếm trong header
    updateCounters();

    // Cập nhật thanh phân trang
    updatePaginationBar();

    // Điều chỉnh chiều cao danh sách để hiển thị ~pageSize dòng và có thanh kéo
    adjustListHeight();
}

function getStatusInfo(status) {
    // Chuyển đổi từ tiếng Anh sang tiếng Việt nếu cần
    const statusMap = {
        'pending': { text: 'đang chờ', dot: 'status-dot-pending' },
        'processing': { text: 'đang xử lý', dot: 'status-dot-processing' },
        'completed': { text: 'hoàn thành', dot: 'status-dot-completed' },
        'failed': { text: 'thất bại', dot: 'status-dot-failed' },
        'đang chờ': { text: 'đang chờ', dot: 'status-dot-pending' },
        'đang xử lý': { text: 'đang xử lý', dot: 'status-dot-processing' },
        'hoàn thành': { text: 'hoàn thành', dot: 'status-dot-completed' },
        'thất bại': { text: 'thất bại', dot: 'status-dot-failed' }
    };
    
    // Chuyển đổi sang chữ thường để so sánh
    const lowerStatus = (status || '').toLowerCase();
    return statusMap[lowerStatus] || { text: status, dot: 'status-dot-pending' };
}

// Cập nhật badge đếm: Tổng, Hoàn thành, Đang xử lý, Đang chờ, Thất bại
function updateCounters() {
    const total = emailData.length;
    // Kiểm tra cả tiếng Anh và tiếng Việt
    const completed = emailData.filter(i => 
        i.status === 'completed' || i.status === 'hoàn thành' || i.status_vi === 'hoàn thành'
    ).length;
    const processing = emailData.filter(i => 
        i.status === 'processing' || i.status === 'đang xử lý' || i.status_vi === 'đang xử lý'
    ).length;
    const pending = emailData.filter(i => 
        i.status === 'pending' || i.status === 'đang chờ' || i.status_vi === 'đang chờ'
    ).length;
    const failed = emailData.filter(i => 
        i.status === 'failed' || i.status === 'thất bại' || i.status_vi === 'thất bại'
    ).length;

    $('#countTotal').text(total);
    $('#countCompleted').text(completed);
    $('#countProcessing').text(processing);
    $('#countPending').text(pending);
    $('#countFailed').text(failed);
}

// Hàm thêm email mới
function addEmail(email) {
    return fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => { throw new Error(err.error || 'Lỗi không xác định'); });
        }
        return response.json();
    })
    .then(() => {
        loadEmailData(); // Tải lại dữ liệu sau khi thêm thành công
    })
    .catch(error => {
        console.error('Lỗi khi thêm email:', error);
        alert(`Thêm email thất bại: ${error.message}`);
        // Ném lại lỗi để chuỗi promise biết là đã thất bại
        throw error;
    });
}

// Hàm nhập nhiều email từ file
function importEmails(emails) {
    fetch('/api/emails/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: emails })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => { throw new Error(err.error || 'Lỗi không xác định'); });
        }
        return response.json();
    })
    .then(imported => {
        $('#importStatus').text(`Đã nhập thành công ${imported.length} email mới.`);
        loadEmailData(); // Tải lại dữ liệu sau khi nhập thành công
    })
    .catch(error => {
        console.error('Lỗi khi nhập email:', error);
        $('#importStatus').text(`Lỗi: ${error.message}`);
    });
}

// Hàm xuất email theo trạng thái
function exportEmails(status) {
    let filteredData = (status === 'all') ? emailData : emailData.filter(item => item.status === status);
    
    if (filteredData.length === 0) {
        alert('Không có dữ liệu email để xuất!');
        return;
    }
    
    const csvContent = filteredData.map(item => item.email).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `emails_${status}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Hàm xem chi tiết email
function viewEmailDetail(id) {
    const email = emailData.find(item => item.id === parseInt(id));
    if (email) {
        displayEmailDetail(email);
    }
}

// Hàm hiển thị chi tiết email trong modal
function displayEmailDetail(email) {
    const statusInfo = getStatusInfo(email.status);
    const detailHTML = `
        <p><strong>ID:</strong> ${email.id}</p>
        <p><strong>Email:</strong> ${email.email}</p>
        <p><strong>Trạng thái:</strong> ${statusInfo.text}</p>
        <p><strong>Ngày tạo:</strong> ${email.created_at}</p>
        <p><strong>Ngày cập nhật:</strong> ${email.updated_at}</p>
    `;
    $('#emailDetailContent').html(detailHTML);
    new bootstrap.Modal(document.getElementById('emailDetailModal')).show();
}

// Hàm cập nhật trạng thái email
function updateEmailStatus(id) {
    const email = emailData.find(item => item.id === parseInt(id));
    if (!email) return;
    
    const newStatus = prompt('Chọn trạng thái mới (pending, processing, completed, failed):', email.status);
    
    if (newStatus && ['pending', 'processing', 'completed', 'failed'].includes(newStatus)) {
        fetch(`/api/emails/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.error || 'Lỗi không xác định'); });
            }
            return response.json();
        })
        .then(() => {
            loadEmailData(); // Tải lại dữ liệu sau khi cập nhật thành công
        })
        .catch(error => {
            console.error('Lỗi khi cập nhật trạng thái:', error);
            alert(`Cập nhật thất bại: ${error.message}`);
        });
    }
}

// Hàm xóa email
function deleteEmail(id) {
    if (confirm('Bạn có chắc chắn muốn xóa email này?')) {
        fetch(`/api/emails/${id}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.error || 'Lỗi không xác định'); });
            }
            return response.json();
        })
        .then(() => {
            loadEmailData(); // Tải lại dữ liệu sau khi xóa thành công
        })
        .catch(error => {
            console.error('Lỗi khi xóa email:', error);
            alert(`Xóa thất bại: ${error.message}`);
        });
    }
}

// Hàm sao chép cookie
function copyCookie(id) {
    const email = emailData.find(item => item.id === parseInt(id, 10));
    const cookie = email ? email.cookie : null;

    if (cookie) {
        navigator.clipboard.writeText(cookie).then(() => {
            alert('Đã sao chép cookie!');
        }).catch(err => {
            console.error('Lỗi sao chép:', err);
            alert('Không thể sao chép cookie.');
        });
    } else {
        alert('Không có cookie để sao chép cho email này.');
    }
}

// Hàm xóa toàn bộ dữ liệu
async function clearAllEmails() {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu? Hành động này không thể hoàn tác.')) {
        return;
    }

    try {
        const response = await fetch('/api/emails', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            // Clear the UI
            const tbody = document.querySelector('#emailTable tbody');
            if (tbody) {
                tbody.innerHTML = '';
            }
            
            // Reset pagination and counters
            currentPage = 1;
            emailData = [];
            updatePagination(0, 1);
            updateCounters();
            
            showNotification('Đã xóa toàn bộ dữ liệu', 'success');
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Lỗi khi xóa dữ liệu');
        }
    } catch (error) {
        console.error('Lỗi:', error);
        showNotification(error.message || 'Có lỗi xảy ra khi xóa dữ liệu', 'error');
    }
}

// Thêm sự kiện click cho nút xóa tất cả
$(document).ready(function() {
    $('#clearAllBtn').click(clearAllEmails);
});
